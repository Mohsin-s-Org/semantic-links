import {
  PluginSettingTab,
  type App,
  type Plugin,
  type SettingDefinitionItem
} from "obsidian";
import {
  MAX_DEBOUNCE_MS,
  MAX_SUGGESTIONS,
  MIN_DEBOUNCE_MS,
  MIN_SUGGESTIONS
} from "../constants.ts";
import { normalizeDelimitedList } from "../utils/validation.ts";
import { DEFAULT_SETTINGS } from "./defaults.ts";
import type { SemanticLinksSettings } from "./types.ts";

type SettingsHost = Plugin & {
  settings: SemanticLinksSettings;
  saveSettings(): Promise<void>;
  openModelSetup?(): void;
  requestModelRemoval?(): void;
};

type SettingKey = keyof SemanticLinksSettings & string;
type ListSettingKey = "excludedFolders" | "excludedFiles" | "excludedTags" | "excludedProperties";

export class SemanticLinksSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: SettingsHost) {
    super(app, owner);
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      this.heading("Suggestions"),
      {
        name: "Automatic suggestions",
        desc: "Evaluate the active writing context after a short pause. Nothing is inserted without confirmation.",
        aliases: ["suggest while typing", "automatic links"],
        control: {
          type: "toggle",
          key: "automaticSuggestions",
          defaultValue: DEFAULT_SETTINGS.automaticSuggestions
        }
      },
      {
        name: "Debounce delay",
        desc: "Milliseconds to wait after editing before a request may begin.",
        aliases: ["typing delay", "suggestion delay"],
        control: {
          type: "number",
          key: "debounceMs",
          defaultValue: DEFAULT_SETTINGS.debounceMs,
          validate: (value) => value >= MIN_DEBOUNCE_MS && value <= MAX_DEBOUNCE_MS
            ? undefined
            : `Choose a value from ${MIN_DEBOUNCE_MS} to ${MAX_DEBOUNCE_MS}.`
        }
      },
      {
        name: "Maximum suggestions",
        desc: "Maximum number of candidates shown for one anchor.",
        aliases: ["result limit", "candidate count"],
        control: {
          type: "number",
          key: "maxSuggestions",
          defaultValue: DEFAULT_SETTINGS.maxSuggestions,
          validate: (value) => Number.isInteger(value)
            && value >= MIN_SUGGESTIONS
            && value <= MAX_SUGGESTIONS
            ? undefined
            : `Choose a whole number from ${MIN_SUGGESTIONS} to ${MAX_SUGGESTIONS}.`
        }
      },
      this.heading("Matching"),
      {
        name: "Lexical matching",
        desc: "Use note titles, aliases, headings, tags and normalized note text. No model download is required.",
        aliases: ["title matching", "alias matching", "fuzzy matching"],
        control: {
          type: "toggle",
          key: "lexicalMatchingEnabled",
          defaultValue: DEFAULT_SETTINGS.lexicalMatchingEnabled
        }
      },
      this.modelSetting(),
      {
        name: "Semantic indexing",
        desc: "Prepare eligible Markdown passages and keep their local vectors current when the semantic model is enabled.",
        aliases: ["embeddings", "model matching", "persistent index"],
        control: {
          type: "toggle",
          key: "semanticIndexingEnabled",
          defaultValue: DEFAULT_SETTINGS.semanticIndexingEnabled
        }
      },
      {
        name: "Minimum confidence",
        desc: "Hide lexical candidates below this normalized score. Semantic similarity is rank-normalized before hybrid scoring.",
        aliases: ["confidence threshold", "minimum score"],
        control: {
          type: "number",
          key: "minimumConfidence",
          defaultValue: DEFAULT_SETTINGS.minimumConfidence,
          validate: (value) => value >= 0 && value <= 1
            ? undefined
            : "Choose a value from 0 to 1."
        }
      },
      this.heading("Scope"),
      this.listSetting(
        "excludedFolders",
        "Excluded folders",
        "One vault-relative folder per line or a comma-separated list.",
        "Archive\nPrivate"
      ),
      this.listSetting(
        "excludedFiles",
        "Excluded files",
        "One vault-relative Markdown path per line or a comma-separated list.",
        "Private/Journal.md\nArchive/Old notes.md"
      ),
      this.listSetting(
        "excludedTags",
        "Excluded tags",
        "One tag per line or a comma-separated list. A leading # is optional.",
        "private\ndraft",
        (values) => values.map((tag) => tag.replace(/^#/u, "").toLocaleLowerCase())
      ),
      this.listSetting(
        "excludedProperties",
        "Excluded property rules",
        "Use a property name to exclude it whenever present, or property=value to match one value. Rules are case-insensitive.",
        "private\npublish=false",
        (values) => values.map((property) => property.toLocaleLowerCase())
      ),
      this.heading("Link insertion"),
      {
        name: "Link path style",
        desc: "Use Obsidian's shortest unambiguous link text or the target's full vault path.",
        aliases: ["wikilink path", "shortest path"],
        control: {
          type: "dropdown",
          key: "linkPathMode",
          defaultValue: DEFAULT_SETTINGS.linkPathMode,
          options: {
            shortest: "Shortest unambiguous path",
            full: "Full vault path"
          }
        }
      }
    ];
  }

  private modelSetting(): SettingDefinitionItem<SettingKey> {
    return {
      name: "Local semantic model",
      aliases: ["download model", "remove model", "semantic matching", "E5"],
      render: (setting) => {
        const installed = this.owner.settings.semanticModelInstalled;
        setting.setDesc(installed
          ? "The verified multilingual model is stored locally. Disable it to keep the files without running semantic queries."
          : "Download the verified multilingual model after reviewing its size and local-only privacy details.");
        if (installed) {
          setting.addToggle((toggle) => {
            toggle
              .setValue(this.owner.settings.semanticModelEnabled)
              .onChange((value) => {
                this.owner.settings.semanticModelEnabled = value;
                void this.owner.saveSettings();
              });
          });
          setting.addButton((button) => {
            button.setWarning().setButtonText("Remove").onClick(() => {
              this.owner.requestModelRemoval?.();
            });
          });
        } else {
          setting.addButton((button) => {
            button.setCta().setButtonText("Set up").onClick(() => {
              this.owner.openModelSetup?.();
            });
          });
        }
      }
    };
  }

  private heading(name: string): SettingDefinitionItem<SettingKey> {
    return {
      name,
      searchable: false,
      render: (setting) => {
        setting.setName(name).setHeading();
      }
    };
  }

  private listSetting(
    key: ListSettingKey,
    name: string,
    description: string,
    placeholder: string,
    transform: (values: string[]) => string[] = (values) => values
  ): SettingDefinitionItem<SettingKey> {
    return {
      name,
      desc: description,
      render: (setting) => {
        setting.addTextArea((text) => {
          text
            .setValue(this.owner.settings[key].join("\n"))
            .setPlaceholder(placeholder)
            .onChange((value) => {
              this.owner.settings[key] = transform(normalizeDelimitedList(value));
              void this.owner.saveSettings();
            });
          text.inputEl.addClass("semantic-links-settings-list");
        });
      }
    };
  }
}
