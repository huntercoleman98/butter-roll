// Trigger a client-side download of text content as a file. Used to export the
// player's notes as a .md file from the settings screen.
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
