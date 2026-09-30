import { ComponentType } from "discord.js";

/** Loose shape of a raw message component, enough to walk rows, containers and sections. */
export interface IRawComponent {
  type: number;
  custom_id?: string;
  disabled?: boolean;
  label?: string;
  components?: IRawComponent[];
  accessory?: IRawComponent;
}

function lockComponent(
  component: IRawComponent,
  clickedId: string,
  workingLabel: string | undefined,
): void {
  component.disabled = true;
  const relabel = workingLabel && component.custom_id === clickedId &&
    component.type === ComponentType.Button;
  if (relabel) component.label = workingLabel;
}

/**
 * Disables the action row holding `clickedId` (or the section accessory that is the clicked
 * button) inside `components`, in place. Link buttons carry no custom ID and stay usable.
 * Returns false when no component in the tree has that ID.
 */
export function disableClickedRow(
  components: IRawComponent[],
  clickedId: string,
  workingLabel?: string,
): boolean {
  for (const component of components) {
    const children = component.components ?? [];
    const isClickedRow = component.type === ComponentType.ActionRow &&
      children.some((child) => child.custom_id === clickedId);
    if (isClickedRow) {
      for (const child of children) {
        if (child.custom_id) lockComponent(child, clickedId, workingLabel);
      }
      return true;
    }
    if (component.accessory?.custom_id === clickedId) {
      lockComponent(component.accessory, clickedId, workingLabel);
      return true;
    }
    if (disableClickedRow(children, clickedId, workingLabel)) return true;
  }
  return false;
}
