import { MEMBER_ROLE_ID } from "../config/roles.js";

/** Whether the interaction/message member holds the Members role. */
export function hasMemberRole(member: any): boolean {
  const roleCache = member?.roles?.cache;
  return Boolean(roleCache?.has(MEMBER_ROLE_ID));
}
