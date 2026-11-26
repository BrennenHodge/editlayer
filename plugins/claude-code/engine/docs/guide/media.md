### Documents, video, focal points and background images (feature: media)

| On the page | How |
|---|---|
| Link to a document | Select some words (or click a button), press the link icon, then **Upload a file** or **Choose a file**. You can upload PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text (.txt) and CSV files, up to 25 MB each. The link field fills in; press **Apply**. |
| Swap the file behind a link | Click a link or button that opens a document. In its toolbar, the upload icon (**Replace the file this links to**) uploads a new file and points the link at it. Ctrl+Z undoes it. |
| Add a video | Click a paragraph, then the video icon (**Insert a video below this paragraph**). Paste a YouTube or Vimeo link (from the Share button). The title, which screen readers announce, fills in by itself; you can change it. The video appears below the paragraph at full width in 16:9. |
| Change or remove a video | Click the video. Use **Change video** to paste another link (a `<video>` also accepts a link to an .mp4 or .webm file), or the bin to delete it. |
| Choose what stays in view in a cropped picture | Click the picture, then **Focus**. Click, drag, tap or use the arrow keys on the preview. The bright box is what visitors see at the current screen size, and the page updates as you move. **Center** resets the point. If the picture is shown whole and never cropped, the popover says so. |
| Background pictures | Click an empty area of a block that has a background picture, or click text inside it and then the background icon. **Replace** opens the image picker, and only the picture changes, so tints and gradients stay. **Focus** works like it does for pictures. |

Everything above is saved as a draft, can be undone, publishes with the page and is kept in history.

**How it works**
- Uploaded documents go to R2 under `files/<id>/<name>`, with a row in `cms_files` (migration `0015_media.sql`). They are served at `/_cms/files/<id>/<name>`. The content type comes from the extension and nosniff is set. PDFs open in the browser; other types download. Files are cached for a year and supported range requests. An old link with the wrong name redirects to the right one.
- Each upload is checked by extension **and** content. A PDF must contain the `%PDF-` header. A Word, Excel or PowerPoint file must be a real Office package: the ZIP lists `[Content_Types].xml` plus the `word/`, `xl/` or `ppt/` parts. Files with macros are refused. Text and CSV files must contain no binary bytes. Older .doc, .xls and .ppt files are refused with a hint to re-save them as .docx, .xlsx or .pptx.
- Videos use a privacy-friendly player: `youtube-nocookie.com` (start time kept) or `player.vimeo.com` with `dnt=1`. An inserted video is a `div.cms-video` with inline styles (`aspect-ratio:16/9`), so the site needs no CSS for it. While editing, video players ignore the pointer so a click selects the video. Visitors get a normal player.
- The focus point is stored as an inline `object-position` on images or `background-position` on backgrounds. Other inline styles are kept.
- Backgrounds are recognised only when set inline (`style="background-image:url(...)"`), for example by the section settings feature. Backgrounds set in the site's CSS are not editable.
- Nothing runs on page views, so pages nobody edited are served unchanged.

**API** (signed in, any role): `POST /_cms/api/files` (multipart `file`), `GET /_cms/api/files`, `GET /_cms/api/video-title?url=`. Public: `GET|HEAD /_cms/files/<id>/<name>`.

**Site setup:** none beyond applying the migration (`npx wrangler d1 migrations apply <db> --remote`) and redeploying. It uses the existing `CMS_DB` and `CMS_MEDIA` bindings. The title lookup calls YouTube and Vimeo oEmbed from the Worker; if that fails, the editor types the title.

**Options:** none.
