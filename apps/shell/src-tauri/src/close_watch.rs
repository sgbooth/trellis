use std::io;
use std::path::Path;

/// Blocks the calling thread until `path` is closed by a process that had it
/// open for writing. Used by the mirror-open-then-reupload flow (download
/// from S3, open locally, wait for the external app to finish, push back) to
/// know when to clean up, without shelling out to `lsof`.
pub fn wait_for_write_close(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        linux::wait_for_write_close(path)
    }
    #[cfg(target_os = "macos")]
    {
        macos::wait_for_write_close(path)
    }
    #[cfg(target_os = "windows")]
    {
        windows::wait_for_write_close(path)
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::ffi::CString;
    use std::io;
    use std::mem;
    use std::os::raw::c_void;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::io::RawFd;
    use std::path::Path;

    /// Closes the inotify fd on every exit path, including `?` early returns.
    struct InotifyFd(RawFd);

    impl Drop for InotifyFd {
        fn drop(&mut self) {
            unsafe {
                libc::close(self.0);
            }
        }
    }

    pub fn wait_for_write_close(path: &Path) -> io::Result<()> {
        let cpath = CString::new(path.as_os_str().as_bytes())?;

        let fd = unsafe { libc::inotify_init1(0) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let fd = InotifyFd(fd);

        let wd = unsafe { libc::inotify_add_watch(fd.0, cpath.as_ptr(), libc::IN_CLOSE_WRITE) };
        if wd < 0 {
            return Err(io::Error::last_os_error());
        }

        let event_size = mem::size_of::<libc::inotify_event>();
        let mut buf = [0u8; 4096];

        loop {
            let n = unsafe { libc::read(fd.0, buf.as_mut_ptr() as *mut c_void, buf.len()) };
            if n < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(err);
            }

            let mut offset = 0usize;
            while offset + event_size <= n as usize {
                // SAFETY: `buf[offset..]` holds a kernel-written inotify_event
                // (fixed 16-byte header, `name` field trails and is skipped
                // via `event.len` rather than read).
                let event = unsafe { &*(buf.as_ptr().add(offset) as *const libc::inotify_event) };
                if event.mask & libc::IN_CLOSE_WRITE != 0 {
                    return Ok(());
                }
                offset += event_size + event.len as usize;
            }
        }
    }
}

/// `EVFILT_VNODE` on macOS only exposes DELETE/WRITE/EXTEND/ATTRIB/LINK/
/// RENAME/REVOKE/FUNLOCK in the public `sys/event.h` (confirmed against the
/// actual SDK header) — unlike FreeBSD, there's no `NOTE_CLOSE_WRITE`, so
/// kqueue can't answer "closed by a writer" directly. Of the real options
/// (poll via `libproc`'s `proc_pidinfo`/`proc_pidfdinfo` — what `lsof` itself
/// calls, without shelling out —, `NSFileCoordinator`, or EndpointSecurity),
/// this implements the `libproc` poll: no subprocess, no Obj-C interop, no
/// Apple-granted entitlement to request.
#[cfg(target_os = "macos")]
mod macos {
    use std::io;
    use std::mem;
    use std::os::raw::c_void;
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;
    use std::ptr;
    use std::thread;
    use std::time::Duration;

    use libc::{c_int, proc_fdinfo, vinfo_stat};

    // Flavor/type selectors for proc_pidinfo/proc_pidfdinfo/proc_listpids.
    // The `libc` crate ships the function signatures and data-carrying
    // structs but not these numeric selectors — taken from Apple's public
    // <sys/proc_info.h>/<libproc.h>, stable since Mac OS X 10.5.
    const PROC_ALL_PIDS: u32 = 1;
    const PROC_PIDLISTFDS: c_int = 1;
    const PROC_PIDFDVNODEINFO: c_int = 1;
    const PROX_FDTYPE_VNODE: u32 = 1;

    /// Mirrors `struct proc_fileinfo` from `<sys/proc_info.h>` — not exposed
    /// by the `libc` crate. Its layout matters here only because it's the
    /// first member of `VnodeFdInfo`, ahead of the `vinfo_stat` this module
    /// actually reads; `fi_openflags` itself is deliberately never decoded
    /// (see `is_open`'s doc comment).
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ProcFileInfo {
        fi_openflags: u32,
        fi_status: u32,
        fi_offset: libc::off_t,
        fi_type: i32,
        fi_guardflags: u32,
    }

    /// Mirrors `struct vnode_info` from `<sys/proc_info.h>` — note this
    /// wraps `vinfo_stat` plus `vi_type`/`vi_pad`/`vi_fsid`, it is *not*
    /// just `vinfo_stat` on its own (that was tried first and rejected by
    /// the kernel with `ENOMEM` — the buffer was 16 bytes short of what
    /// `proc_pidfdinfo` expects).
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct VnodeInfo {
        vi_stat: vinfo_stat,
        vi_type: i32,
        vi_pad: i32,
        vi_fsid: [i32; 2],
    }

    /// Mirrors `struct vnode_fdinfo` from `<sys/proc_info.h>` — the buffer
    /// shape `proc_pidfdinfo` fills for the `PROC_PIDFDVNODEINFO` flavor.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct VnodeFdInfo {
        pfi: ProcFileInfo,
        pvi: VnodeInfo,
    }

    const POLL_INTERVAL: Duration = Duration::from_millis(500);

    fn list_all_pids() -> Vec<i32> {
        unsafe {
            let needed = libc::proc_listpids(PROC_ALL_PIDS, 0, ptr::null_mut(), 0);
            if needed <= 0 {
                return Vec::new();
            }
            // Padded to absorb processes spawned between the sizing call
            // and the real one.
            let cap = needed as usize / mem::size_of::<i32>() + 64;
            let mut buf = vec![0i32; cap];
            let bufsize = (buf.len() * mem::size_of::<i32>()) as c_int;
            let ret =
                libc::proc_listpids(PROC_ALL_PIDS, 0, buf.as_mut_ptr() as *mut c_void, bufsize);
            if ret <= 0 {
                return Vec::new();
            }
            buf.truncate(ret as usize / mem::size_of::<i32>());
            buf.retain(|&pid| pid != 0);
            buf
        }
    }

    fn list_fds(pid: i32) -> Vec<proc_fdinfo> {
        unsafe {
            let needed = libc::proc_pidinfo(pid, PROC_PIDLISTFDS, 0, ptr::null_mut(), 0);
            if needed <= 0 {
                return Vec::new();
            }
            let cap = needed as usize / mem::size_of::<proc_fdinfo>() + 16;
            let mut buf: Vec<proc_fdinfo> = vec![mem::zeroed(); cap];
            let bufsize = (buf.len() * mem::size_of::<proc_fdinfo>()) as c_int;
            let ret = libc::proc_pidinfo(
                pid,
                PROC_PIDLISTFDS,
                0,
                buf.as_mut_ptr() as *mut c_void,
                bufsize,
            );
            if ret <= 0 {
                return Vec::new();
            }
            buf.truncate(ret as usize / mem::size_of::<proc_fdinfo>());
            buf
        }
    }

    fn vnode_fd_info(pid: i32, fd: i32) -> Option<VnodeFdInfo> {
        unsafe {
            let mut info: VnodeFdInfo = mem::zeroed();
            let size = mem::size_of::<VnodeFdInfo>() as c_int;
            let ret = libc::proc_pidfdinfo(
                pid,
                fd,
                PROC_PIDFDVNODEINFO,
                &mut info as *mut _ as *mut c_void,
                size,
            );
            if ret == size {
                Some(info)
            } else {
                None
            }
        }
    }

    /// True if any process currently holds an open file descriptor on the
    /// vnode identified by `(dev, ino)` — matching by identity rather than
    /// path string, the same thing `lsof` keys off, so a bind-mount/symlink/
    /// reopen-elsewhere doesn't produce a false "closed."
    ///
    /// Deliberately coarser than the Linux implementation's
    /// `IN_CLOSE_WRITE`, which fires specifically on close-of-a-writer: this
    /// treats "open at all, by anyone" as "still in use" rather than
    /// decoding `fi_openflags`'s FREAD/FWRITE bit encoding, which is an
    /// XNU-internal detail not worth getting subtly wrong here. Good enough
    /// for "has the external app finished with this file," which is the
    /// only thing this scaffold's callers need today.
    fn is_open(dev: u32, ino: u64) -> bool {
        for pid in list_all_pids() {
            for fd in list_fds(pid) {
                if fd.proc_fdtype != PROX_FDTYPE_VNODE {
                    continue;
                }
                if let Some(info) = vnode_fd_info(pid, fd.proc_fd) {
                    if info.pvi.vi_stat.vst_dev == dev && info.pvi.vi_stat.vst_ino == ino {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn wait_for_write_close(path: &Path) -> io::Result<()> {
        let metadata = std::fs::metadata(path)?;
        let dev = metadata.dev() as u32;
        let ino = metadata.ino();

        // Same unhandled race the Linux inotify path has: if the external
        // app opens and closes the file before we get here, this blocks
        // forever. Acceptable for this scaffold's use case (watching starts
        // right as the file is handed to the external app), same tradeoff
        // already made on Linux rather than new risk introduced here.
        while !is_open(dev, ino) {
            thread::sleep(POLL_INTERVAL);
        }
        while is_open(dev, ino) {
            thread::sleep(POLL_INTERVAL);
        }
        Ok(())
    }
}

/// Not yet implemented. Windows has no native push event for "last writer
/// closed this handle" — needs either an oplock (`FSCTL_REQUEST_OPLOCK`) or
/// a poll-based fallback (`CreateFileW` with exclusive share mode).
#[cfg(target_os = "windows")]
mod windows {
    use std::io;
    use std::path::Path;

    pub fn wait_for_write_close(_path: &Path) -> io::Result<()> {
        unimplemented!("Windows close-detection not yet implemented — see close_watch.rs doc comment")
    }
}
