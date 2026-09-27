import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} from "obsidian";

interface Annotation {
  id: number;
  bookId: number;
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  origin: string;
  createdAt: string;
  bookTitle: string;
  author: string;
  jumpFileId: number | null;
  jumpFileFormat: string | null;
  cfi: string | null;
  pageno: number | null;
}

interface AnnotationsResponse {
  items: Annotation[];
  total: number;
  page: number;
  pageSize: number;
}

interface BookOrbitSettings {
  serverUrl: string;
  username: string;
  password: string;
  outputFolder: string;
  includeMetadata: boolean;
  lastSyncTime: string;
  customProperties: string;
  syncReadBooks: boolean;
  syncOnLaunch: boolean;
  readerLinks: boolean;
  downloadCovers: boolean;
  colorTags: string;
}

// Defines the default settings for the plugin on install
const DEFAULT_SETTINGS: BookOrbitSettings = {
  serverUrl: "",
  username: "",
  password: "",
  outputFolder: "Books",
  includeMetadata: true,
  lastSyncTime: "",
  customProperties: "",
  syncReadBooks: false,
  syncOnLaunch: true,
  readerLinks: true,
  downloadCovers: true,
  colorTags: "",
};

export default class BookOrbitPlugin extends Plugin {
  settings!: BookOrbitSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("book-open", "Sync BookOrbit Highlights", async () => {
      await this.runSync();
    });

    this.addCommand({
      id: "sync-bookorbit",
      name: "Sync highlights",
      callback: async () => {
        await this.runSync();
      },
    });

    this.addSettingTab(new BookOrbitSettingTab(this.app, this));

    // The highlights will auto sync if these settings are present
    this.app.workspace.onLayoutReady(async () => {
      if (
        this.settings.serverUrl &&
        this.settings.username &&
        this.settings.password &&
        this.settings.syncOnLaunch
      ) {
        await this.runSync();
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async runSync() {
    if (
      !this.settings.serverUrl ||
      !this.settings.username ||
      !this.settings.password
    ) {
      new Notice(
        "BookOrbit Sync: Please configure your server URL and credentials in settings."
      );
      return;
    }

    new Notice("BookOrbit Sync: Starting sync...");

    try {
      const token = await this.login();
      const annotations = await this.fetchNewAnnotations(token);
      
      // Create notes for finished books that don't have one yet
      if (this.settings.syncReadBooks) {
        const libraryIds = await this.fetchLibraries(token);
        for (const libraryId of libraryIds) {
          const finishedBooks = await this.fetchFinishedBooks(libraryId, token);
          for (const book of finishedBooks) {
            await this.writeEmptyBookNote(book, token);
          }
        }
      }
      if (annotations.length === 0) {
        new Notice("BookOrbit Sync: No new highlights.");
        return;
      }

      const byBook = this.groupByBook(annotations);

      let totalHighlights = 0;
      for (const bookAnnotations of Object.values(byBook)) {
        await this.writeBookNote(bookAnnotations, token);
        totalHighlights += bookAnnotations.length;
      }

      this.settings.lastSyncTime = new Date().toISOString();
      await this.saveSettings();

      const bookCount = Object.keys(byBook).length;
      new Notice(
        `BookOrbit Sync: Synced ${totalHighlights} highlight${totalHighlights !== 1 ? "s" : ""} across ${bookCount} book${bookCount !== 1 ? "s" : ""}.`
      );
    } catch (error) {
      console.error("BookOrbit Sync error:", error);
      new Notice(`BookOrbit Sync: Error — ${(error as Error).message}`);
    }
  }

async login(): Promise<string> {
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");

    // Step 1: log in with username/password to get a refresh_token cookie
    const loginResponse = await requestUrl({
      url: `${baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.settings.username,
        password: this.settings.password,
      }),
      throw: false,
    });

    if (loginResponse.status !== 200) {
      throw new Error(
        `Login failed (${loginResponse.status}). Check your credentials in settings.`
      );
    }

    const rawCookies = loginResponse.headers["set-cookie"] ?? "";
    const cookieString = Array.isArray(rawCookies)
      ? rawCookies.join("; ")
      : String(rawCookies);

    const refreshMatch = cookieString.match(/refresh_token=([^;]+)/);
    if (!refreshMatch) {
      console.error("BookOrbit Sync: Could not extract refresh token. Headers:", loginResponse.headers);
      throw new Error("Could not extract refresh token from login response.");
    }
    const refreshToken = refreshMatch[1];

    // Step 2: exchange the refresh_token for an access token via a clean JSON response
    // (more reliable across platforms than reading access_token from a second Set-Cookie header)
    const refreshResponse = await requestUrl({
      url: `${baseUrl}/api/v1/auth/refresh`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `refresh_token=${refreshToken}`,
      },
      throw: false,
    });

    if (refreshResponse.status !== 200) {
      throw new Error(
        `Failed to refresh access token (${refreshResponse.status}).`
      );
    }

    const refreshData = refreshResponse.json;
    if (!refreshData?.accessToken) {
      console.error("BookOrbit Sync: Refresh response missing accessToken:", refreshData);
      throw new Error("Refresh response did not contain an access token.");
    }

    return refreshData.accessToken;
  }

  async fetchNewAnnotations(token: string): Promise<Annotation[]> {
    const allAnnotations: Annotation[] = [];
    const lastSync = this.settings.lastSyncTime
      ? new Date(this.settings.lastSyncTime)
      : null;
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");

    let page = 1;
    let keepFetching = true;

    while (keepFetching) {
      const url = `${baseUrl}/api/v1/annotations?page=${page}&pageSize=50&status=active&sortBy=createdAt&sortDir=desc`;

      const response = await requestUrl({
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        throw: false,
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch annotations (${response.status}).`
        );
      }

      const data: AnnotationsResponse = response.json;

      for (const annotation of data.items) {
        if (lastSync && new Date(annotation.createdAt) <= lastSync) {
          keepFetching = false;
          break;
        }
        allAnnotations.push(annotation);
      }

      const totalPages = Math.ceil(data.total / data.pageSize);
      if (page >= totalPages) keepFetching = false;
      page++;
    }

    return allAnnotations;
  }

  async fetchLibraries(token: string): Promise<number[]> {
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/v1/libraries`;

    const response = await requestUrl({
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch libraries (${response.status}).`);
    }

    const libraries = response.json;
    return libraries.map((library: { id: number }) => library.id);
  }

  async fetchFinishedBooks(libraryId: number, token: string): Promise<any[]> {
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/v1/libraries/${libraryId}/books`;
    
    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,},
      body: JSON.stringify({
        sort: [{ field: "title", dir: "asc" }],
        filter: {
          type: "group",
          join: "AND",
          rules: [
            { type: "rule", field: "readStatus", operator: "includesAny", value: ["read"] }
         ]
        },
        collapseSeries: true,
        pagination: { page: 0, size: 100 }
      }),
      throw: false,
    });
if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Failed to fetch books (${response.status}).`);
  }
    return response.json.items;
  }


  groupByBook(annotations: Annotation[]): Record<string, Annotation[]> {
    const groups: Record<string, Annotation[]> = {};

    for (const annotation of annotations) {
      const key = String(annotation.bookId);
      if (!groups[key]) groups[key] = [];
      groups[key].push(annotation);
    }

for (const key of Object.keys(groups)) {
  groups[key].sort((a, b) => {
    if (a.pageno !== null && b.pageno === null) return -1;
    if (a.pageno === null && b.pageno !== null) return 1;
    if (a.pageno !== null && b.pageno !== null && a.pageno !== b.pageno) {
      return a.pageno - b.pageno;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

    return groups;
  }

  async writeBookNote(annotations: Annotation[], token: string) {
    const first = annotations[0];
    const safeTitle = first.bookTitle.replace(/[\\/:*?"<>|]/g, "-");
    const folderPath = normalizePath(this.settings.outputFolder);
    const safeAuthor = first.author.replace(/[\\/:*?"<>|]/g, "-");
    const filePath = normalizePath(`${folderPath}/${safeTitle} - ${safeAuthor}.md`);
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const bookUrl = `${baseUrl}/annotations?bookId=${first.bookId}`;

    await this.ensureFolder(folderPath);

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (!existingFile) {
      const coverPath = this.settings.downloadCovers ? await this.downloadCover(first.bookId, safeTitle, token) : null;
      const content = this.buildFullNote(annotations, bookUrl, first, coverPath);
      await this.app.vault.create(filePath, content);
    } else {
      if (!(existingFile instanceof TFile)) return;
      const file = existingFile;
      const existing = await this.app.vault.read(file);
      const toAppend = this.buildHighlightsBlock(annotations);
      await this.app.vault.modify(file, existing + toAppend);
    }
  }

  async writeEmptyBookNote(book: any, token: string) {
    const title: string = book.title;
    const author: string = (book.authors ?? []).join(", ");
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-");
    const safeAuthor = author.replace(/[\\/:*?"<>|]/g, "-");
    const folderPath = normalizePath(this.settings.outputFolder);
    const filePath = normalizePath(`${folderPath}/${safeTitle} - ${safeAuthor}.md`);
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const bookUrl = `${baseUrl}/annotations?bookId=${book.id}`;

    await this.ensureFolder(folderPath);

    // If a note for this book already exists (with or without highlights), leave it alone
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile) return;

    const coverPath = this.settings.downloadCovers ? await this.downloadCover(book.id, safeTitle, token) : null;

    const customProps = this.settings.customProperties
      ? this.settings.customProperties + "\n"
      : "";
    const coverProperty = coverPath
      ? `cover: "[[${coverPath}]]"\n`
      : "";
    const now = new Date().toISOString();

    const content = `---
title: "${title}"
author: "${author}"
bookorbit_book_id: ${book.id}
bookorbit_url: ${bookUrl}
last_synced: ${now}
${coverProperty}${customProps}---

# ${title}
*${author}*

[View in BookOrbit](${bookUrl})

`;

    await this.app.vault.create(filePath, content);
  }

// Defines what will be shown in the full exported file
  buildFullNote(
    annotations: Annotation[],
    bookUrl: string,
    first: Annotation,
    coverPath : string | null
  ): string {
    const customProps = this.settings.customProperties
      ? this.settings.customProperties + "\n"
      : "";
    const coverProperty = coverPath
      ? `cover: "[[${coverPath}]]"\n`
      : "";
    const now = new Date().toISOString();
    const header = `---
title: "${first.bookTitle}"
author: "${first.author}"
bookorbit_book_id: ${first.bookId}
bookorbit_url: ${bookUrl}
last_synced: ${now}
${coverProperty}${customProps}---

# ${first.bookTitle}
*${first.author}*

[View in BookOrbit](${bookUrl})

`;
    return header + this.buildHighlightsBlock(annotations);
  }

  /**
   * Builds the BookOrbit reader deep link for an annotation, mirroring the
   * client's annotationReaderRoute(): /read/{bookId}/{fileId}?format=…&cfi=… (or &page=… for PDF).
   */
  readerLink(annotation: Annotation): string | null {
    if (!annotation.jumpFileId || !annotation.jumpFileFormat) return null;
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const params = new URLSearchParams({ format: annotation.jumpFileFormat });
    if (annotation.cfi) params.set("cfi", annotation.cfi);
    else if (annotation.pageno !== null) params.set("page", String(annotation.pageno));
    else return null;
    return `${baseUrl}/read/${annotation.bookId}/${annotation.jumpFileId}?${params.toString()}`;
  }

  /**
   * Parses the "Colour tags" setting (one `#hex = tag` pair per line) into a lookup map.
   * Keys are lower-cased hex colours; values are tags without the leading '#'.
   */
  parseColorTags(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const raw of this.settings.colorTags.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const hex = line.slice(0, idx).trim().toLowerCase();
      const tag = line.slice(idx + 1).trim().replace(/^#/, "");
      if (hex && tag) map[hex] = tag;
    }
    return map;
  }

  buildHighlightsBlock(annotations: Annotation[]): string {
    let block = "";
    const colorTags = this.parseColorTags();

    for (const annotation of annotations) {
      const date = this.formatDate(annotation.createdAt);
      const source = this.formatSource(annotation.origin);
      const chapter = annotation.chapterTitle && this.settings.includeMetadata ? annotation.chapterTitle + " · " : "";
      const page = annotation.pageno !== null && this.settings.includeMetadata ? `Page ${annotation.pageno} · ` : "";

      block += `---\n\n`;
      block += `> ${annotation.text.replace(/\n/g, "\n> ")}\n\n`;

      if (annotation.note) {
        block += `> [!NOTE] Annotation\n> ${annotation.note}\n\n`;
      }

      const link = this.settings.readerLinks ? this.readerLink(annotation) : null;
      const linkPart = link ? ` · [Open in reader](${link})` : "";
      const tag = colorTags[(annotation.color ?? "").toLowerCase()];
      const tagPart = tag ? ` #${tag}` : "";

      if (this.settings.includeMetadata){
      block += `*${source} · ${date} · ${chapter}${page}<span style="color: ${annotation.color};">●</span>${linkPart}*${tagPart}\n\n`;
      } else if (linkPart || tagPart) {
      block += `${linkPart ? `*${linkPart.slice(3)}*` : ""}${tagPart}\n\n`;
      }
    }

    return block;
  }

  formatDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatSource(origin: string): string {
    const map: Record<string, string> = {
      koreader: "KOReader",
      kobo: "Kobo",
      web: "Web",
    };
    return map[origin] ?? origin;
  }

  async downloadCover(bookId: number, safeTitle: string, token :string): Promise<string | null> {
    const baseUrl = this.settings.serverUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/v1/books/${bookId}/thumbnail`;

    const response = await requestUrl({
      url,
      headers: {
        Authorization: `Bearer ${token}`
      },
      throw: false,
    });

    if (response.status !== 200) {
      return null;
    }

    const coverFolder = normalizePath(`${this.settings.outputFolder}/covers`);
    await this.ensureFolder(coverFolder);

    const coverPath = normalizePath(`${coverFolder}/${safeTitle}.jpg`);
    await this.app.vault.createBinary(coverPath, response.arrayBuffer);

    return coverPath;
  }

  async ensureFolder(path: string) {
    const exists = this.app.vault.getAbstractFileByPath(path);
    if (!exists) {
      await this.app.vault.createFolder(path);
    }
  }
}


class BookOrbitSettingTab extends PluginSettingTab {
  plugin: BookOrbitPlugin;

  constructor(app: App, plugin: BookOrbitPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("The full URL of your BookOrbit instance.")
      .addText((text) =>
        text
          .setPlaceholder("https://bookorbit.yourdomain.com")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Username")
      .addText((text) =>
        text
          .setPlaceholder("your username")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Password")
      .addText((text) => {
        text
          .setPlaceholder("your password")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Sync extra metadata")
      .setDesc("Include source, time highlighted, highlight colour, chapter title, and page number in synced highlights.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.includeMetadata)
        .onChange(async (value) => {
          this.plugin.settings.includeMetadata = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Folder in your vault where book notes will be saved.")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim().replace(/\.\./g, "").replace(/^\/+|\/+$/g, "") || "Books";
            await this.plugin.saveSettings();
          })
      );
    
    new Setting (containerEl)
      .setName("Custom properties")
      .setDesc("Add custom properties to all synced highlights.")
      .addTextArea ((text) => {
        text 
          .setPlaceholder("Property: PropertyValue")
          .setValue(this.plugin.settings.customProperties)
          .onChange(async (value) => {
            this.plugin.settings.customProperties = value;
            await this.plugin.saveSettings();
          })
      });

    new Setting (containerEl)
      .setName("Sync read books?")
      .setDesc("Create a note for all books marked as Read on BookOrbit, even if they have no highlights.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.syncReadBooks)
        .onChange(async (value) => {
          this.plugin.settings.syncReadBooks = value;
          await this.plugin.saveSettings();
          })
        );

    new Setting(containerEl)
      .setName("Sync on launch?")
      .setDesc("Enable or disable automatic syncing of highlights on launch of Obsidian.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.syncOnLaunch)
        .onChange(async (value) => {
          this.plugin.settings.syncOnLaunch = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Reader deep links")
      .setDesc("Append an \"Open in reader\" link to each highlight that jumps to its exact position in the BookOrbit web reader.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.readerLinks)
        .onChange(async (value) => {
          this.plugin.settings.readerLinks = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Download covers")
      .setDesc("Save book covers into the output folder and reference them from the note's cover property.")
      .addToggle((toggle) =>
        toggle
        .setValue(this.plugin.settings.downloadCovers)
        .onChange(async (value) => {
          this.plugin.settings.downloadCovers = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Colour tags")
      .setDesc("Map highlight colours to Obsidian tags, one per line as `#hex = tag` (e.g. `#FACC15 = hl/cite`). Matching highlights get the tag appended so they can be queried.")
      .addTextArea((text) =>
        text
        .setPlaceholder("#FACC15 = hl/cite\n#4ADE80 = hl/agree")
        .setValue(this.plugin.settings.colorTags)
        .onChange(async (value) => {
          this.plugin.settings.colorTags = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Manually trigger a sync.")
      .addButton((btn) =>
        btn
          .setButtonText("Sync")
          .setCta()
          .onClick(async () => {
            await this.plugin.runSync();
          })
      );

    if (this.plugin.settings.lastSyncTime) {
      new Setting(containerEl)
        .setName("Last synced")
        .setDesc(this.plugin.formatDate(this.plugin.settings.lastSyncTime));
    }

    new Setting(containerEl)
      .setName("Reset sync")
      .setDesc("Clears the last sync time. Next sync will re-import everything.")
      .addButton((btn) =>
        btn
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.lastSyncTime = "";
            await this.plugin.saveSettings();
            new Notice("Last sync time cleared");
            this.display();
          })
      );
  }
}
