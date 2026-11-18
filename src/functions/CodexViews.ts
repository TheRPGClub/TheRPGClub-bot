import {
  ActionRowBuilder,
  type APIMessageTopLevelComponent,
  type ButtonBuilder,
} from "discord.js";
import {
  buildComponentsV2View,
  buildTextContainer,
  type IComponentsV2View,
} from "./ComponentsV2Utils.js";

// The Club Codex's plain replies, shared by every part: Fun Facts, Club Lore and Club
// History. Mentions in them show as names and never ping.

/** A Club Codex reply of text, with an optional row of buttons. */
export function codexView(content: string, buttons: ButtonBuilder[] = []): IComponentsV2View {
  const components: APIMessageTopLevelComponent[] = [buildTextContainer(content).toJSON()];
  if (buttons.length) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON());
  }
  return buildComponentsV2View(components);
}
