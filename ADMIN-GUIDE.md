# Admin guide

Open `…/admin.html` and sign in with your admin email and password. The session ends when you close the browser or log out. If it expires, you are asked to sign in again.

## Sections

- **Profile:** your name, tagline, introduction, stats, contact links, profile photo and CV. Click **Save changes** at the bottom. The bar shows *Unsaved changes* until you save.
- **Skills / Projects / Certificates:** lists of items.
  - **Add** with the button at the top right. **Edit** with the pencil icon. Both open a side panel.
  - **Delete** with the bin icon. You are asked to confirm first, and you can choose to delete the item's uploaded files too.
  - The **switch** shows or hides an item on the public site. Hidden items stay in the admin.
  - The **arrows** change the order. Skills are ordered within their category.
- **Files:** everything in storage, showing where each file is used. You can open a file, copy its link, delete it, or clean up all unused files.

## Writing text

- **Tagline:** wrap one word in `*asterisks*` to give it the animated gradient, e.g. `Designing with *security* in mind.`
- **About text / descriptions:** leave an empty line between paragraphs.
- **Project "Detailed description":**
  - The first paragraphs are the main description.
  - For an extra titled block, put a short heading ending in `:` on its own line, then the text on the lines below:

    ```
    Scope:
    The mitigations were analytical recommendations.
    ```

  - A line like `Login → Booking → Checkout` is shown as flow chips.
- Every field has a character limit, shown as a counter under the field.

## Uploading files

Drag a file onto the upload box or click **choose a file**. You see a preview and a progress bar. The file is stored right away, but it only goes live on the site after you **Save**.

| Field | Allowed | Max |
| --- | --- | --- |
| Profile photo, project image, certificate image | JPG, PNG, WebP | 5 MB |
| Skill icon | PNG, WebP (light or coloured icon on transparent background, because tiles are dark) | 5 MB |
| CV, project document | PDF | 10 MB |

- SVG files are refused for security reasons. Export them as PNG or WebP instead.
- **Replace** swaps in a new file. **Remove** clears the field. In both cases, the old file is deleted from storage when you save, and you are asked to confirm first.
- If you close a form without saving, files uploaded in that form are deleted automatically.
- Missing files never break the site. Visitors see a placeholder such as *Document coming soon*, *Image coming soon*, or *CV coming soon*.

## Good to know

- Changes show up on the public site when the page is reloaded. No deploy is needed.
- Skill categories are free text with suggestions, matched by name (capitalisation doesn't matter). Each category is one card in the Skills section. The five built-in categories (Security, Web Development, Networking/Server, Database, Tools) keep their colours and ornaments. A new category becomes a new card automatically, with the next free accent colour and a default ornament. A category with no visible skills is not shown.
- Leave **Level** empty to show no level label on the tile.
- Forgot your password? Reset it in Supabase under **Authentication → Users**.
