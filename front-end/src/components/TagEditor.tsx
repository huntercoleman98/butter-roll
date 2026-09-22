import { useState, type KeyboardEvent } from "react";

// A chip editor for a free-form string list (token/page tags). Emits granular
// add/remove (not a whole-list replace) so it serves both a single target (a
// page) and a whole selection (tokens, where `tags` is the set shared by every
// selected token — adding/removing applies to all). Adding a tag already shown
// is a no-op. Shared by the token right-click menu and the Map dropdown.
export default function TagEditor({
  tags,
  onAdd,
  onRemove,
  placeholder = "Add tag…",
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const tag = raw.trim();
    setDraft("");
    if (tag && !tags.includes(tag)) onAdd(tag);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onRemove(tags[tags.length - 1]);
    }
  }

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-chip-remove"
            aria-label={`Remove ${tag}`}
            onClick={() => onRemove(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
