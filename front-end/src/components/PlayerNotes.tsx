import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./PlayerNotes.css";

interface Props {
  // Current notes markdown (the initial editor content). Source of truth lives
  // in the character blob; edits flow back up via onChange.
  value: string;
  onChange: (markdown: string) => void;
  ready: boolean;
}

// The "Notes" tab of the player window: an Obsidian-style live-preview markdown
// editor. Content is a plain markdown string stored on the character sheet blob
// (character.notes), so it persists and survives restarts via the existing sync.
// markdownShortcutPlugin gives the live "type `# ` → heading" WYSIWYG feel.
//
// Lazily imported by <Player> so MDXEditor stays out of the initial bundle until
// the tab is opened. Styling overrides live in PlayerNotes.css, namespaced under
// .player-notes so they don't leak into the shared App.css surface.
export default function PlayerNotes({ value, onChange, ready }: Props) {
  return (
    <div className="player-notes">
      <MDXEditor
        markdown={value}
        onChange={onChange}
        readOnly={!ready}
        placeholder="What comes next? Time will tell."
        contentEditableClassName="player-notes-prose"
        // Serialize bullet lists with "-" instead of the mdast default "*".
        // listItemIndent mirrors MDXEditor's own default so we don't clobber it.
        toMarkdownOptions={{ listItemIndent: "one", bullet: "-" }}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <ListsToggle />
              </>
            ),
          }),
        ]}
      />
    </div>
  );
}
