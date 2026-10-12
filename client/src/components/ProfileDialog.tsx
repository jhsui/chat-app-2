import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";
import type { Profile, PublicUser } from "../../../shared/types";
import { api, errorMessage } from "../api.ts";
import { nameOf } from "../format.ts";
import { toSquareAvatar } from "../image.ts";
import { cx, ui } from "../ui.ts";
import Avatar from "./Avatar.tsx";

const MAX_DISPLAY_NAME = 40;
const MAX_BIO = 160;

interface ProfileDialogProps {
  userId: number;
  me: PublicUser;
  isOnline: (user: { id: number; online?: boolean }) => boolean;
  onClose: () => void;
  /** Your own profile changed (name, bio or avatar). */
  onProfileSaved: (profile: Profile) => void;
  /** "Message" button on someone else's profile. */
  onMessage: (user: PublicUser) => void;
}

/**
 * A profile in a modal dialog. Your own profile is editable (avatar, display
 * name, bio); anyone else's is read-only.
 */
export default function ProfileDialog({
  userId,
  me,
  isOnline,
  onClose,
  onProfileSaved,
  onMessage,
}: ProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");
  const isMe = userId === me.id;

  // <dialog>.showModal() gives us focus trapping, Esc to close and a backdrop for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .profile(userId)
      .then(({ profile }) => !cancelled && setProfile(profile))
      .catch((err) => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function updated(next: Profile) {
    setProfile(next);
    onProfileSaved(next);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // Clicking the dimmed backdrop (outside the panel) closes the dialog.
      onClick={(e) =>
        e.target === dialogRef.current && dialogRef.current?.close()
      }
      aria-label={isMe ? "Your profile" : "Profile"}
      className="m-auto w-[min(420px,calc(100%-2rem))] rounded-[20px] border border-line bg-panel p-0 text-fg shadow-[0_20px_60px_rgb(0_0_0/0.25)] backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-bold">{isMe ? "Your profile" : "Profile"}</h2>
        <button
          className={cx(ui.btnGhost, "text-xl leading-none")}
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="p-6">
        {loadError ? (
          <p className={ui.error} role="alert">
            {loadError}
          </p>
        ) : !profile ? (
          <p className="py-10 text-center text-muted">Loading…</p>
        ) : isMe ? (
          <EditProfile profile={profile} onUpdated={updated} />
        ) : (
          <ViewProfile
            profile={profile}
            online={isOnline(profile)}
            onMessage={() => {
              onMessage(profile);
              dialogRef.current?.close();
            }}
          />
        )}
      </div>
    </dialog>
  );
}

function joined(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
}

function ProfileHeader({
  profile,
  online,
}: {
  profile: Profile;
  online: boolean;
}) {
  return (
    <div className="mt-3 text-center">
      <h3 className="text-xl font-bold break-words">{nameOf(profile)}</h3>
      <p className="text-sm text-muted">
        @{profile.username} ·{" "}
        <span
          className={online ? "text-green-700 dark:text-green-300" : undefined}
        >
          {online ? "Online" : "Offline"}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Joined {joined(profile.createdAt)}
      </p>
    </div>
  );
}

function ViewProfile({
  profile,
  online,
  onMessage,
}: {
  profile: Profile;
  online: boolean;
  onMessage: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Avatar
        name={nameOf(profile)}
        src={profile.avatarUrl}
        online={online}
        size={96}
      />
      <ProfileHeader profile={profile} online={online} />
      <p
        className={cx(
          "mt-4 w-full rounded-xl bg-panel-2 px-4 py-3 text-center whitespace-pre-wrap wrap-anywhere",
          !profile.bio && "text-muted",
        )}
      >
        {profile.bio || "No bio yet."}
      </p>
      <button className={cx(ui.btnPrimary, "mt-5 w-full")} onClick={onMessage}>
        Message {nameOf(profile)}
      </button>
    </div>
  );
}

function EditProfile({
  profile,
  onUpdated,
}: {
  profile: Profile;
  onUpdated: (profile: Profile) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty =
    displayName.trim() !== (profile.displayName ?? "") ||
    bio.trim() !== (profile.bio ?? "");

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still triggers a change
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const image = await toSquareAvatar(file);
      const { profile: next } = await api.uploadAvatar(image);
      onUpdated(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setError("");
    setUploading(true);
    try {
      const { profile: next } = await api.removeAvatar();
      onUpdated(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { profile: next } = await api.updateProfile({ displayName, bio });
      onUpdated(next);
      setDisplayName(next.displayName ?? "");
      setBio(next.bio ?? "");
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col" onSubmit={handleSubmit}>
      <div className="flex flex-col items-center">
        <div className="relative">
          <Avatar name={nameOf(profile)} src={profile.avatarUrl} size={96} />
          {uploading && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-xs font-semibold text-white">
              Uploading…
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={cx(ui.btnGhost, "border border-line text-sm")}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {profile.avatarUrl ? "Change photo" : "Upload photo"}
          </button>
          {profile.avatarUrl && (
            <button
              type="button"
              className={cx(ui.btnGhost, "text-sm")}
              onClick={removeAvatar}
              disabled={uploading}
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
          aria-label="Choose a profile photo"
        />
        <ProfileHeader profile={profile} online />
      </div>

      <label className="mt-5 flex flex-col gap-1.5 text-sm font-medium">
        Display name
        <input
          className={ui.input}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setSaved(false);
          }}
          maxLength={MAX_DISPLAY_NAME}
          placeholder={profile.username}
        />
      </label>
      <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
        <span className="flex justify-between">
          Bio
          <span className="font-normal text-muted">
            {bio.length}/{MAX_BIO}
          </span>
        </span>
        <textarea
          className={cx(ui.input, "resize-none")}
          rows={3}
          value={bio}
          onChange={(e) => {
            setBio(e.target.value);
            setSaved(false);
          }}
          maxLength={MAX_BIO}
          placeholder="A little about you"
        />
      </label>

      {error && (
        <p className={cx(ui.error, "mt-3")} role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        {saved && !dirty && <span className="text-sm text-muted">Saved ✓</span>}
        <button
          className={ui.btnPrimary}
          type="submit"
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
