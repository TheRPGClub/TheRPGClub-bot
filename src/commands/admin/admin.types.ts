import { ButtonStyle } from "discord.js";

export type AdminHelpTopicId =
  | "add-gotm"
  | "edit-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "delete-gotm-noms"
  | "delete-nr-gotm-noms"
  | "set-nextvote"
  | "voting-setup"
  | "voting-open"
  | "voting-close"
  | "voting-results"
  | "votes-reset"
  | "nextround-setup"
  | "sync";

export type AdminHelpTopic = {
  id: AdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

export type PromptChoiceOption = {
  label: string;
  value: string;
  style?: ButtonStyle;
};

export type WizardAction = {
  description: string;
  execute: () => Promise<void>;
};

export const VOTING_TITLE_MAX_LEN = 38;
