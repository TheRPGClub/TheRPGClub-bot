import assert from "node:assert/strict";
import test from "node:test";

import {
  birthDateButtonReply,
  birthDateCommandReply,
  birthDateModalReply,
  BIRTH_DATE_ENTRY_FIELD,
  buildBirthDateEntryModal,
  formatBirthDate,
  parseBirthDateInput,
  type IBirthDateApi,
  type IBirthDateChange,
  type IBirthDateDocument,
} from "../services/BirthDateService.js";
import { apiError, buttonsOf, textOf } from "./challengeFixtures.js";

// Parsing what members type in `date:` (bot#1557): a full date, MM-DD, or a day and month
// in words. The API decides whether the day is real; the bot only reads the shape.

test("parseBirthDateInput: a full date is sent as typed, zero-padded", () => {
  assert.equal(parseBirthDateInput("1990-05-04"), "1990-05-04");
  assert.equal(parseBirthDateInput(" 1990-5-4 "), "1990-05-04");
});

test("parseBirthDateInput: MM-DD leaves out the year", () => {
  assert.equal(parseBirthDateInput("05-04"), "05-04");
  assert.equal(parseBirthDateInput("5-4"), "05-04");
  assert.equal(parseBirthDateInput("02-29"), "02-29");
});

test("parseBirthDateInput: a day and month in words, either way round", () => {
  assert.equal(parseBirthDateInput("4 May"), "05-04");
  assert.equal(parseBirthDateInput("May 4"), "05-04");
  assert.equal(parseBirthDateInput("4th of may"), "05-04");
  assert.equal(parseBirthDateInput("Sept 21st"), "09-21");
  assert.equal(parseBirthDateInput("31 Dec."), "12-31");
});

test("parseBirthDateInput: words may carry the year", () => {
  assert.equal(parseBirthDateInput("4 May 1990"), "1990-05-04");
  assert.equal(parseBirthDateInput("May 4, 1990"), "1990-05-04");
});

test("parseBirthDateInput: other shapes aren't read", () => {
  for (const typed of ["05/04", "4-5-1990", "Ma 4", "4 Moon", "May", "", "tomorrow"]) {
    assert.equal(parseBirthDateInput(typed), null, typed);
  }
});

test("formatBirthDate: states the date in words, with the year only when there is one", () => {
  assert.equal(formatBirthDate("05-04"), "4 May");
  assert.equal(formatBirthDate("02-29"), "29 February");
  assert.equal(formatBirthDate("1990-05-04"), "4 May 1990");
  assert.equal(formatBirthDate("2026-12-01"), "1 December 2026");
});

// The reply (design 3B): a private settings panel with the Birth Date in words, whether the
// Birthday is shared, and buttons that change it in place.

function doc(overrides: Partial<IBirthDateDocument> = {}): IBirthDateDocument {
  return {
    userId: "42",
    birthDate: "05-04",
    birthdayShared: false,
    changesLeftThisMonth: 1,
    nextChangeOn: null,
    ...overrides,
  };
}

interface IFakeBirthDateApi extends IBirthDateApi {
  calls: string[];
}

/** Records each call; answers `get` and `put`, or throws their errors. */
function fakeApi(options: {
  get?: IBirthDateDocument;
  put?: IBirthDateDocument;
  putError?: unknown;
  getError?: unknown;
} = {}): IFakeBirthDateApi {
  const api: IFakeBirthDateApi = {
    calls: [],
    getBirthDate: async (userId, actingUserId) => {
      api.calls.push(`get ${userId} as ${actingUserId}`);
      if (options.getError) throw options.getError;
      return options.get ?? doc({ userId });
    },
    updateBirthDate: async (userId, change: IBirthDateChange, actingUserId) => {
      api.calls.push(`put ${userId} ${JSON.stringify(change)} as ${actingUserId}`);
      if (options.putError) throw options.putError;
      return options.put ?? doc({ userId });
    },
  };
  return api;
}

function putError(status: number, body: unknown, data: unknown, userId = "42") {
  return apiError(status, body, {
    method: "put",
    url: `/api/v1/users/${userId}/birth_date`,
    data: { data },
  });
}

const OWN = { actingUserId: "42", targetUserId: "42" };
const STAFF = { actingUserId: "42", targetUserId: "7" };

function buttons(view: { components: unknown }): string[][] {
  return buttonsOf(view.components).map((b) => [b.label, b.customId ?? ""]);
}

test("view: your own panel states the date in words and that it isn't shared", async () => {
  const api = fakeApi({ get: doc({ changesLeftThisMonth: 2 }) });
  const view = await birthDateCommandReply({ ...OWN }, { api });

  assert.deepEqual(api.calls, ["get 42 as 42"]);
  assert.equal(
    textOf(view.components),
    [
      "### Your Birth Date\n**4 May** · no year\n-# Only you and staff see this.",
      "**Birthday: Not shared**\n" +
        "-# Members don't see it, and there's no Birthday Post for you.",
      "-# 2 Birth Date changes left this month · sharing doesn't count",
    ].join("\n"),
  );
  assert.deepEqual(buttons(view), [
    ["Share it", "birth-date-v1:share-on:42"],
    ["Change date", "birth-date-v1:date:42"],
    ["Remove Birth Date", "birth-date-v1:remove:42"],
  ]);
  assert.deepEqual(view.allowedMentions, { parse: [] });
});

test("view: a shared Birthday says where members see it, with a Stop sharing button",
  async () => {
    const api = fakeApi({
      get: doc({ birthDate: "1990-05-04", birthdayShared: true, changesLeftThisMonth: 1 }),
    });
    const view = await birthDateCommandReply({ ...OWN }, { api });
    const text = textOf(view.components);

    assert.match(text, /^\*\*4 May 1990\*\*$/m);
    assert.match(text, /^\*\*Birthday: Shared\*\*$/m);
    assert.match(
      text,
      /^-# Members see 4 May in Upcoming Birthdays, and you get a Birthday Post\.$/m,
    );
    assert.match(text, /^-# 1 Birth Date change left this month/m);
    assert.deepEqual(buttons(view)[0], ["Stop sharing", "birth-date-v1:share-off:42"]);
  });

test("view: with no changes left, the footer names the day they open again", async () => {
  const api = fakeApi({ get: doc({ changesLeftThisMonth: 0, nextChangeOn: "2026-12-01" }) });
  const view = await birthDateCommandReply({ ...OWN }, { api });
  assert.match(
    textOf(view.components),
    /^-# No Birth Date changes left until 1 December 2026 · sharing doesn't count$/m,
  );
});

test("view: without a Birth Date, the panel says sharing needs one and offers to enter it",
  async () => {
    const api = fakeApi({ get: doc({ birthDate: null, changesLeftThisMonth: 2 }) });
    const view = await birthDateCommandReply({ ...OWN }, { api });

    assert.equal(
      textOf(view.components),
      [
        "### Your Birth Date\n" +
          "Not entered yet. Sharing your Birthday needs one; the year is optional.",
        "-# Only you and staff ever see your Birth Date. " +
          "Shared, members see just the day and month.",
      ].join("\n"),
    );
    assert.deepEqual(buttons(view), [["Enter Birth Date", "birth-date-v1:date:42"]]);
  });

/** The friendly line, then the full request and response as JSON blocks (CLAUDE.md). */
function assertRefusal(text: string, friendly: string, status: number): void {
  assert.ok(text.includes(friendly), text);
  assert.match(text, /Request:\n```json/);
  assert.match(text, /"url": "\/api\/v1\/users\/\d+\/birth_date"/);
  assert.match(text, new RegExp(`Response:\\n\`\`\`json[\\s\\S]*"status": ${status}`));
}

// Setting the date from `date:`.

test("set: a day and month in words is sent as MM-DD and confirmed back in words",
  async () => {
    const api = fakeApi({ put: doc({ birthDate: "05-04" }) });
    const view = await birthDateCommandReply({ ...OWN, date: " May 4th " }, { api });

    assert.deepEqual(api.calls, ['put 42 {"birthDate":"05-04"} as 42']);
    assert.match(textOf(view.components), /^Saved\. Your Birth Date is now \*\*4 May\*\*\.$/m);
    assert.match(textOf(view.components), /^\*\*4 May\*\* · no year$/m);
  });

test("set: a full date keeps its year", async () => {
  const api = fakeApi({ put: doc({ birthDate: "1990-05-04" }) });
  const view = await birthDateCommandReply({ ...OWN, date: "1990-05-04" }, { api });
  assert.deepEqual(api.calls, ['put 42 {"birthDate":"1990-05-04"} as 42']);
  assert.match(textOf(view.components), /^Saved\. Your Birth Date is now \*\*4 May 1990\*\*\.$/m);
});

test("set: a date the bot can't read isn't sent, and the panel says how to enter it",
  async () => {
    const api = fakeApi();
    const view = await birthDateCommandReply({ ...OWN, date: "05/04" }, { api });

    assert.deepEqual(api.calls, ["get 42 as 42"]);
    assert.match(
      textOf(view.components),
      /^That isn't a date the bot can read: `05\/04`\. Enter it as YYYY-MM-DD, or leave out /m,
    );
    assert.match(textOf(view.components), /^### Your Birth Date$/m);
  });

test("set: a date the API won't take shows its reason and the exchange above the panel",
  async () => {
    const api = fakeApi({
      putError: putError(422, {
        error: "birth_date must be a date (YYYY-MM-DD, or MM-DD without the year)",
      }, { birth_date: "04-31", acting_user_id: "42" }),
    });
    const view = await birthDateCommandReply({ ...OWN, date: "31 April" }, { api });
    const text = textOf(view.components);

    assert.deepEqual(api.calls, ['put 42 {"birthDate":"04-31"} as 42', "get 42 as 42"]);
    assertRefusal(
      text,
      "That Birth Date wasn't saved: birth_date must be a date (YYYY-MM-DD, or MM-DD " +
        "without the year). Enter it as YYYY-MM-DD, or leave out the year: MM-DD or 4 May.",
      422,
    );
    assert.match(text, /^### Your Birth Date$/m);
  });

test("set: the limit refusal shows the API's message with the date, and the exchange",
  async () => {
    const message = "You can change your Birth Date twice a month, and you've already " +
      "changed it twice this month. You can change it again on 1 December 2026.";
    const api = fakeApi({
      putError: putError(422, { error: message, next_change_on: "2026-12-01" },
        { birth_date: "05-04", acting_user_id: "42" }),
    });
    const view = await birthDateCommandReply({ ...OWN, date: "05-04" }, { api });
    assertRefusal(textOf(view.components), message, 422);
  });

test("set: other API errors are thrown for the command's error reply", async () => {
  const error = putError(500, { error: "boom" }, { birth_date: "05-04" });
  const api = fakeApi({ putError: error });
  await assert.rejects(
    birthDateCommandReply({ ...OWN, date: "05-04" }, { api }),
    (err) => err === error,
  );
});

test("set: a date and remove together are refused without calling the API", async () => {
  const api = fakeApi();
  const view = await birthDateCommandReply({ ...OWN, date: "05-04", remove: true }, { api });
  assert.equal(textOf(view.components), "Pick a date or remove, not both.");
  assert.deepEqual(api.calls, []);
});

test("remove: sends null and says it's removed", async () => {
  const api = fakeApi({ put: doc({ birthDate: null, changesLeftThisMonth: 1 }) });
  const view = await birthDateCommandReply({ ...OWN, remove: true }, { api });
  assert.deepEqual(api.calls, ['put 42 {"birthDate":null} as 42']);
  assert.match(textOf(view.components), /^Your Birth Date is removed\.$/m);
  assert.deepEqual(buttons(view), [["Enter Birth Date", "birth-date-v1:date:42"]]);
});

// The `share:` option.

test("share: a date and share:True go in one update, and the panel shows it shared",
  async () => {
    const api = fakeApi({ put: doc({ birthDate: "05-04", birthdayShared: true }) });
    const view = await birthDateCommandReply({ ...OWN, date: "05-04", share: true }, { api });

    assert.deepEqual(api.calls, ['put 42 {"birthDate":"05-04","birthdayShared":true} as 42']);
    assert.match(textOf(view.components), /^\*\*Birthday: Shared\*\*$/m);
    assert.deepEqual(buttons(view)[0], ["Stop sharing", "birth-date-v1:share-off:42"]);
  });

test("share: share:False alone stops sharing, with no notice about the date", async () => {
  const api = fakeApi({ put: doc({ birthdayShared: false }) });
  const view = await birthDateCommandReply({ ...OWN, share: false }, { api });

  assert.deepEqual(api.calls, ['put 42 {"birthdayShared":false} as 42']);
  assert.match(textOf(view.components), /^### Your Birth Date\n/);
  assert.match(textOf(view.components), /^\*\*Birthday: Not shared\*\*$/m);
});

test("share: sharing without a Birth Date shows the API's hint on the empty panel",
  async () => {
    const api = fakeApi({
      get: doc({ birthDate: null }),
      putError: putError(422, {
        error: "birth_date_required",
        message: "Enter your Birth Date before you share your Birthday.",
      }, { birthday_shared: true, acting_user_id: "42" }),
    });
    const view = await birthDateCommandReply({ ...OWN, share: true }, { api });
    const text = textOf(view.components);

    assert.deepEqual(api.calls, ['put 42 {"birthdayShared":true} as 42', "get 42 as 42"]);
    assert.match(text, /^Enter your Birth Date before you share your Birthday\.$/m);
    assert.match(text, /^Not entered yet\. Sharing your Birthday needs one; /m);
    assert.deepEqual(buttons(view), [["Enter Birth Date", "birth-date-v1:date:42"]]);
  });

test("share: remove with share:True is refused without calling the API", async () => {
  const api = fakeApi();
  const view = await birthDateCommandReply({ ...OWN, remove: true, share: true }, { api });
  assert.equal(
    textOf(view.components),
    "Removing a Birth Date stops sharing its Birthday, so pick one.",
  );
  assert.deepEqual(api.calls, []);
});

// Staff, with `member:`.

test("staff: another member's panel names them, and offers no Share button", async () => {
  const api = fakeApi({ get: doc({ userId: "7", changesLeftThisMonth: 2 }) });
  const view = await birthDateCommandReply({ ...STAFF }, { api });

  assert.deepEqual(api.calls, ["get 7 as 42"]);
  assert.equal(
    textOf(view.components),
    [
      "### <@7>'s Birth Date\n**4 May** · no year\n-# Only they and staff see this.",
      "**Birthday: Not shared**\n-# Members don't see it. Only <@7> can share it.",
      "-# 2 Birth Date changes left for them this month · staff changes don't count",
    ].join("\n"),
  );
  assert.deepEqual(buttons(view), [
    ["Change date", "birth-date-v1:date:7"],
    ["Remove Birth Date", "birth-date-v1:remove:7"],
  ]);
});

test("staff: can stop sharing a member's Birthday", async () => {
  const api = fakeApi({ put: doc({ userId: "7", birthdayShared: false }) });
  const view = await birthDateCommandReply({ ...STAFF, share: false }, { api });
  assert.deepEqual(api.calls, ['put 7 {"birthdayShared":false} as 42']);
  assert.match(textOf(view.components), /^\*\*Birthday: Not shared\*\*$/m);
});

test("staff: turning sharing on for a member is refused with the API's answer",
  async () => {
    const api = fakeApi({
      get: doc({ userId: "7" }),
      putError: putError(403, { error: "forbidden" },
        { birthday_shared: true, acting_user_id: "42" }, "7"),
    });
    const view = await birthDateCommandReply({ ...STAFF, share: true }, { api });
    const text = textOf(view.components);

    assert.deepEqual(api.calls, ['put 7 {"birthdayShared":true} as 42', "get 7 as 42"]);
    assertRefusal(
      text,
      "Only <@7> can share their Birthday. Staff can stop sharing it, but never turn it on.",
      403,
    );
    assert.match(text, /"error": "forbidden"/);
    assert.match(text, /^### <@7>'s Birth Date$/m);
  });

test("staff: a member naming someone else gets the staff-only refusal", async () => {
  const api = fakeApi({
    putError: putError(403, { error: "forbidden" }, { birth_date: "05-04" }, "7"),
  });
  const view = await birthDateCommandReply({ ...STAFF, date: "05-04" }, { api });
  assert.deepEqual(api.calls, ['put 7 {"birthDate":"05-04"} as 42']);
  assertRefusal(
    textOf(view.components),
    "Only staff can see or set another member's Birth Date.",
    403,
  );
});

test("staff: setting a member's date says whose it is", async () => {
  const api = fakeApi({ put: doc({ userId: "7", birthDate: "1985-12-31" }) });
  const view = await birthDateCommandReply({ ...STAFF, date: "1985-12-31" }, { api });
  assert.match(
    textOf(view.components),
    /^Saved\. <@7>'s Birth Date is now \*\*31 December 1985\*\*\.$/m,
  );
});

// The panel's buttons, which edit it in place.

test("button: Share it turns sharing on as the clicking member, in place", async () => {
  const api = fakeApi({ put: doc({ birthdayShared: true }) });
  const view = await birthDateButtonReply(
    { customId: "birth-date-v1:share-on:42", actingUserId: "42" },
    { api },
  );
  assert.deepEqual(api.calls, ['put 42 {"birthdayShared":true} as 42']);
  assert.match(textOf(view.components), /^\*\*Birthday: Shared\*\*$/m);
  assert.deepEqual(buttons(view)[0], ["Stop sharing", "birth-date-v1:share-off:42"]);
});

test("button: Stop sharing turns it off, in place", async () => {
  const api = fakeApi({ put: doc({ birthdayShared: false }) });
  const view = await birthDateButtonReply(
    { customId: "birth-date-v1:share-off:42", actingUserId: "42" },
    { api },
  );
  assert.deepEqual(api.calls, ['put 42 {"birthdayShared":false} as 42']);
  assert.deepEqual(buttons(view)[0], ["Share it", "birth-date-v1:share-on:42"]);
});

test("button: Remove Birth Date asks first, then removes, or keeps it", async () => {
  const api = fakeApi({ put: doc({ birthDate: null }) });
  const confirm = await birthDateButtonReply(
    { customId: "birth-date-v1:remove:42", actingUserId: "42" },
    { api },
  );
  assert.deepEqual(api.calls, []);
  assert.match(textOf(confirm.components), /^Remove your Birth Date\? /);
  assert.deepEqual(buttons(confirm), [
    ["Remove it", "birth-date-v1:remove-yes:42"],
    ["Keep it", "birth-date-v1:keep:42"],
  ]);

  const removed = await birthDateButtonReply(
    { customId: "birth-date-v1:remove-yes:42", actingUserId: "42" },
    { api },
  );
  assert.deepEqual(api.calls, ['put 42 {"birthDate":null} as 42']);
  assert.match(textOf(removed.components), /^Your Birth Date is removed\.$/m);

  const kept = await birthDateButtonReply(
    { customId: "birth-date-v1:keep:42", actingUserId: "42" },
    { api: fakeApi() },
  );
  assert.match(textOf(kept.components), /^\*\*4 May\*\* · no year$/m);
});

test("button: an unknown custom ID says it's out of date", async () => {
  const api = fakeApi();
  const view = await birthDateButtonReply(
    { customId: "birth-date-v1:explode:42", actingUserId: "42" },
    { api },
  );
  assert.match(textOf(view.components), /^This button is out of date\. Run /);
  assert.deepEqual(api.calls, []);
});

// Change date and Enter Birth Date open a modal.

test("modal: Change date opens a modal naming the member, and saving sets the date",
  async () => {
    const modal = buildBirthDateEntryModal("birth-date-v1:date:7", "42")?.toJSON();
    assert.equal(modal?.custom_id, "birth-date-v1:date-modal:7");
    assert.match(JSON.stringify(modal), new RegExp(`"custom_id":"${BIRTH_DATE_ENTRY_FIELD}"`));
    assert.match(JSON.stringify(modal), /MM-DD or 4 May/);

    const api = fakeApi({ put: doc({ userId: "7", birthDate: "12-31" }) });
    const view = await birthDateModalReply(
      { customId: "birth-date-v1:date-modal:7", actingUserId: "42", date: "31 December" },
      { api },
    );
    assert.deepEqual(api.calls, ['put 7 {"birthDate":"12-31"} as 42']);
    assert.match(
      textOf(view.components),
      /^Saved\. <@7>'s Birth Date is now \*\*31 December\*\*\.$/m,
    );
  });

test("modal: only the date button opens one", () => {
  assert.equal(buildBirthDateEntryModal("birth-date-v1:remove:42", "42"), null);
});
