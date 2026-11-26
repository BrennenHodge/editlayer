## Page checks and Edit as form (feature: quality)

### Checks before publishing
When an editor presses **Publish**, Editlayer first looks over the page. If everything is fine, the page publishes straight away. If something needs attention, a **Before you publish** list appears, grouped as Page settings, Pictures, Links and buttons, Headings, Hard-to-read text and Unfinished text. Each item says what's wrong in plain words and has two buttons:

- **Show me** scrolls to the spot and selects it, so the normal toolbar can fix it (for example the link or picture-description button). A bar at the top steps through every issue ("2 of 5", Previous / Next) and can bring the list back. Title and description issues open Page settings with that field ready.
- **Ignore** stops the warning for this page. Ignored warnings are saved with the page's draft and published with it, and they appear under "N ignored" in the list, with **Warn again** to undo.

Then choose **Go back** or **Publish anyway**. The same check runs any time from **Page settings → Check this page**.

What it looks for:
- Pictures with no description, or with a file name as the description. Small icons and pictures inside a link that already has words are treated as decorative.
- Links that go nowhere (empty, "#") or that say "click here"; email and phone links that look wrong; web addresses missing https://; links to pages on this site that don't exist; jumps to a spot ("#section") that isn't on the page.
- Buttons and links with no words.
- More than one main heading, headings that skip a level, and empty headings.
- Text that's hard to read against its background (WCAG AA: 4.5 to 1, or 3 to 1 for large text). Text over pictures is skipped.
- A page title over 60 characters, a description over 160, or either one empty.
- Leftover placeholder text: [square brackets], {{curly brackets}}, Lorem ipsum, TODO or TBD notes, sample pictures, and unreplaced prompts such as "Add a short description of the service."

The checks cover the page being edited and the site-wide footer. Links to other websites are only checked for their shape (a browser can't safely open other sites to test them). If the check itself fails, publishing goes ahead: it never blocks a publish because of its own error.

### Edit as form
Select anything inside a repeated item (a team member, a test in the catalog, a table row, a service card or a list item) and press **Edit as form** in the toolbar. A panel lists every part of the item as a labelled field:
- Labels come from the page: Name, Role, Bio, Standard, Lead time, Location, table column headings, Heading, Text, List item…
- Text with links or bold keeps them; each link gets **Words** and **Goes to**, with the site's pages suggested.
- Each picture shows a thumbnail, **Replace** (upload or library) and its description.
- Hidden "Read bio" text is included.

**Save** applies the changes as one step (Ctrl+Z undoes it), and Ctrl+S also saves. **Previous / Next** move through the matching items (for example "8 of 92" in the test catalog). **Add another like this** puts a copy below and opens it with the first field selected, ready to type over. The bin button deletes the item. Closing the panel never throws away what was typed: it's saved, and Ctrl+Z still works.

### Site setup
Nothing is required: the feature turns on when `client/features/quality.*` and `src/features/quality.js` are built in (`npm run build`). It needs no new bindings, tables or migrations. It stores ignored warnings in the per-page draft key `#checks` (`{ "ignored": ["links:…", …] }`), which the Worker validates (known categories only, up to 300 entries of 190 characters). Visitors never receive it, and pages nobody edited stay untouched (no `alwaysRender`).

Site cooperation, if the site has a search or filter: build it from the visible text rather than a word list baked in at build time, so names changed in the editor are found.

### Options
None.
