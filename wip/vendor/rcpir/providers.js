// Retrieval providers: where column j of R is stored. The class fixes the provider's name and host; the
// configuration only supplies its parameters (a site name, a file ID), so the name shown to users always matches
// the host that is contacted. See providers/*.md for the assessments.
import { RcPirError } from "./errors.js";
import { columnLocation } from "./query.js";
/** The shards of R on https://<site>.github.io/rc-pir/r/<k> (docs/protocol.md §2). */
export class GitHubPages {
    name = "GitHub Pages";
    origin;
    constructor(site) {
        if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(site)) {
            throw new RcPirError("bad-argument", `not a GitHub Pages site name: ${site}`);
        }
        this.origin = new URL(`https://${site.toLowerCase()}.github.io`);
    }
    locate(j, p) {
        const { path, offset } = columnLocation(j, p.columns_per_shard, p.L);
        return { url: new URL(path, this.origin), offset };
    }
}
/**
 * All of R in one Google Drive file shared as "anyone with the link" (column j at offset j * L), read through the
 * Drive API with an API key: the only Drive endpoint browsers can use from another site (providers/GOOGLE_DRIVE.md).
 */
export class GoogleDrive {
    name = "Google Drive";
    url;
    constructor(fileId, apiKey) {
        if (!/^[A-Za-z0-9_-]+$/.test(fileId))
            throw new RcPirError("bad-argument", `not a Google Drive file ID: ${fileId}`);
        if (!apiKey)
            throw new RcPirError("bad-argument", "Google Drive needs an API key");
        this.url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
        this.url.searchParams.set("alt", "media");
        this.url.searchParams.set("key", apiKey);
    }
    locate(j, p) {
        return { url: this.url, offset: j * p.L };
    }
}
/**
 * All of R in one OneDrive file (column j at offset j * L), from its "Anyone with the link" share link
 * https://<tenant>-my.sharepoint.com/:<type>:/<g|r>/personal/<user>/<token>. Read through
 * /personal/<user>/_layouts/15/download.aspx?share=<token>: no cookie, Access-Control-Allow-Origin: *, the only
 * OneDrive endpoint browsers can use from another site. Folder links do not work there (providers/ONEDRIVE.md).
 */
export class OneDrive {
    name = "OneDrive";
    url;
    constructor(shareLink) {
        const bad = (why) => new RcPirError("bad-argument", `not a OneDrive file share link (${why}): ${shareLink}`);
        let link;
        try {
            link = new URL(shareLink);
        }
        catch {
            throw bad("invalid URL");
        }
        if (link.protocol !== "https:" || link.port || !/^[a-z0-9-]+-my\.sharepoint\.com$/.test(link.hostname)) {
            throw bad("expected https://<tenant>-my.sharepoint.com");
        }
        const m = /^\/:([a-z]):\/[gr]\/personal\/([A-Za-z0-9_]+)\/([A-Za-z0-9_-]+)\/?$/.exec(link.pathname);
        if (!m)
            throw bad("expected /:<type>:/g/personal/<user>/<token>");
        if (m[1] === "f")
            throw bad("this is a folder link; share the file itself");
        this.url = new URL(`https://${link.hostname}/personal/${m[2]}/_layouts/15/download.aspx`);
        this.url.searchParams.set("share", m[3]);
    }
    locate(j, p) {
        return { url: this.url, offset: j * p.L };
    }
}
//# sourceMappingURL=providers.js.map