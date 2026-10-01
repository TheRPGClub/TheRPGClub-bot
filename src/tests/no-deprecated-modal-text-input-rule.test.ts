import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-deprecated-modal-text-input"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester();

ruleTester.run("no-deprecated-modal-text-input", rule, {
  valid: [
    "new ModalBuilder().setTitle('t').addLabelComponents(buildTextInputLabel(opts));",
    "modal.addLabelComponents(label);",
    "new LabelBuilder().setLabel('Name').setTextInputComponent(input);",
    "new ButtonBuilder().setLabel('Go');",
    "const button = new ButtonBuilder(); button.setLabel('Go');",
    "row.addComponents(button);",
    "container.addActionRowComponents(row);",
  ],
  invalid: [
    {
      code: "new TextInputBuilder().setCustomId('a').setLabel('Name');",
      errors: [{ messageId: "textInputLabel" }],
    },
    {
      code: "const input = new TextInputBuilder().setCustomId('a'); input.setLabel('Name');",
      errors: [{ messageId: "textInputLabel" }],
    },
    {
      code: "new ModalTextInputBuilder().setLabel('Name');",
      errors: [{ messageId: "textInputLabel" }],
    },
    {
      code: "new ModalBuilder().setCustomId('a').setTitle('t').addComponents(row);",
      errors: [{ messageId: "modalActionRow" }],
    },
    {
      code: "new ComponentsModalBuilder().addActionRowComponents(row);",
      errors: [{ messageId: "modalActionRow" }],
    },
    {
      code: "modal.addComponents(row);",
      errors: [{ messageId: "modalActionRow" }],
    },
    {
      code: "reasonModal.setComponents(row);",
      errors: [{ messageId: "modalActionRow" }],
    },
  ],
});
