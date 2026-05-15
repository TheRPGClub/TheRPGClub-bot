export const REGULARS_ROLE_ID = "267883288817958912";
export const ADMIN_ROLE_ID =
  process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() ?? null;
export const MODERATOR_ROLE_ID =
  process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() ?? null;
export const MEMBER_ROLE_ID =
  process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() ?? null;
