import { useState } from "react";
import type { IdentityInfo } from "@trellis/sdk";

/**
 * Asks the browser user who they are, once. The desktop shell gets this from
 * the OS instead (`get_os_identity`).
 *
 * This is NOT a sign-in. The broker has no authentication and treats a
 * claimed identity as audit-trail metadata only (see the SECURITY note in
 * apps/server/src/app.ts), so anything typed here is accepted as-is — exactly
 * like the OS-reported name on desktop, which is equally unverified. The
 * wording below says so rather than implying a login happened.
 */
export interface IdentityPromptProps {
  onSubmit: (identity: IdentityInfo) => void;
}

export function IdentityPrompt({ onSubmit }: IdentityPromptProps) {
  const [displayName, setDisplayName] = useState("");

  const trimmed = displayName.trim();

  return (
    <div className="app-root">
      <form
        style={{ maxWidth: "28rem", margin: "0 auto", padding: "3rem 1rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          // The username is the greppable handle the broker logs and stamps
          // onto chat messages; the display name is what people read.
          onSubmit({ username: toUsername(trimmed), displayName: trimmed });
        }}
      >
        <h2>Who are you?</h2>
        <p>
          Used to label what you send. This is not a login — nothing verifies it, and the
          server only records it.
        </p>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          autoFocus
          style={{ width: "100%", padding: "0.6em", fontSize: "1em", marginBottom: "0.75rem" }}
        />
        <button type="submit" disabled={!trimmed}>
          Continue
        </button>
      </form>
    </div>
  );
}

/** "Simon Booth" -> "simon.booth", so it reads like the OS usernames the
 *  desktop path produces rather than an arbitrary string. */
function toUsername(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return slug || "web.user";
}
