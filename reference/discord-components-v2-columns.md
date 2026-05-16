# Discord Components V2 -- Multi-Column Layouts

**Source research**: [embed-generator by merlinfuchs](https://github.com/merlinfuchs/embed-generator)

---

## Overview

Discord's Components V2 allows multi-column message layouts by nesting multiple `Section`
components inside a `Container`. Discord renders the sections side by side, producing the
column effect. There is no explicit "column" type -- the layout is implied by the structure.

---

## Required Message Flag

To use Components V2, you **must** set `flags: 32768` (`1 << 15`) on the message payload.

```ts
await channel.send({
  flags: 1 << 15,
  components: [ /* ... */ ],
});
```

> **Note:** When this flag is active, traditional `embeds` cannot be used in the same message.

---

## Component Types Reference

| Type | Name         | Purpose                                               |
|------|--------------|-------------------------------------------------------|
| 9    | Section      | One column of content; holds text + optional accessory |
| 10   | TextDisplay  | A block of text inside a Section                      |
| 11   | Thumbnail    | Right-aligned image accessory inside a Section        |
| 14   | Separator    | Visual divider / spacing between components           |
| 17   | Container    | Outer wrapper that groups Sections into columns       |

---

## Structure

```
Container (type 17)
  Section (type 9)          <-- Column 1
    TextDisplay (type 10)
    TextDisplay (type 10)
    accessory: Thumbnail (type 11)  [optional]
  Section (type 9)          <-- Column 2
    TextDisplay (type 10)
    accessory: Thumbnail (type 11)  [optional]
  ...up to 10 total sub-components
```

### Limits

| Component   | Min children | Max children |
|-------------|-------------|-------------|
| Container   | 1           | 10          |
| Section     | 1           | 5 TextDisplays |
| TextDisplay | n/a         | n/a         |

Each `Section` may also have **one** right-aligned accessory, which must be either:
- A `Thumbnail` (type 11) -- displays an image
- A `Button` (type 2) -- displays an action button

---

## JSON Payload Example

```json
{
  "flags": 32768,
  "components": [
    {
      "id": 1,
      "type": 17,
      "components": [
        {
          "id": 2,
          "type": 9,
          "components": [
            { "id": 3, "type": 10, "content": "**Column 1 Title**" },
            { "id": 4, "type": 10, "content": "First column body text." }
          ],
          "accessory": {
            "id": 5,
            "type": 11,
            "media": { "url": "https://example.com/image1.png" }
          }
        },
        {
          "id": 6,
          "type": 9,
          "components": [
            { "id": 7, "type": 10, "content": "**Column 2 Title**" },
            { "id": 8, "type": 10, "content": "Second column body text." }
          ],
          "accessory": {
            "id": 9,
            "type": 11,
            "media": { "url": "https://example.com/image2.png" }
          }
        }
      ]
    }
  ]
}
```

---

## TypeScript Helper (Conceptual)

Discord.js does not yet have full typings for Components V2 components. Until it does,
you will need to construct the raw payload objects and cast or use `as unknown`.

```ts
const FLAG_COMPONENTS_V2 = 1 << 15;

function textDisplay(id: number, content: string) {
  return { id, type: 10, content };
}

function thumbnail(id: number, url: string) {
  return { id, type: 11, media: { url } };
}

function section(
  id: number,
  texts: ReturnType<typeof textDisplay>[],
  accessory?: ReturnType<typeof thumbnail>,
) {
  return { id, type: 9, components: texts, ...(accessory ? { accessory } : {}) };
}

function container(id: number, children: object[]) {
  return { id, type: 17, components: children };
}

// Usage
const payload = {
  flags: FLAG_COMPONENTS_V2,
  components: [
    container(1, [
      section(2, [textDisplay(3, "**Col 1**"), textDisplay(4, "Body text")], thumbnail(5, url1)),
      section(6, [textDisplay(7, "**Col 2**"), textDisplay(8, "Body text")], thumbnail(9, url2)),
    ]),
  ],
};
```

---

## Rules and Gotchas

- Every component must have a **unique numeric `id`** within the message.
- `flags: 1 << 15` is **required** -- omitting it causes the message to be rejected.
- Traditional `embeds` cannot coexist with Components V2 in the same message.
- A Section's `accessory` is always right-aligned; there is no left-side accessory option.
- Discord.js typings may not cover these component types yet -- construct raw objects as needed.
- Containers support other sub-component types too (ActionRow type 1, Separator type 14, etc.),
  not just Sections.
