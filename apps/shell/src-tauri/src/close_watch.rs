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

/// Not yet implemented. `EVFILT_VNODE` on macOS only exposes
/// DELETE/WRITE/EXTEND/ATTRIB/LINK/RENAME/REVOKE/FUNLOCK in the public
/// `sys/event.h` (confirmed against the actual SDK header) — unlike FreeBSD,
/// there's no `NOTE_CLOSE_WRITE`, so kqueue can't answer "closed by a
/// writer" directly. Real options: poll via `libproc` (proc_pidinfo /
/// proc_pidfdinfo — what `lsof` itself calls, without shelling out),
/// NSFileCoordinator (event-driven but needs Obj-C interop and editor
/// cooperation), or EndpointSecurity (exact, but needs an Apple-granted
/// entitlement). Deliberately stubbed until one of those is chosen.
#[cfg(target_os = "macos")]
mod macos {
    use std::io;
    use std::path::Path;

    pub fn wait_for_write_close(_path: &Path) -> io::Result<()> {
        unimplemented!("macOS close-detection not yet implemented — see close_watch.rs doc comment")
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
