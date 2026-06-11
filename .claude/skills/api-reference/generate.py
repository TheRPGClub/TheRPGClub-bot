#!/usr/bin/env python3
"""
Generate .claude/skills/api-reference/SKILL.md from a local swagger YAML file.

Usage:
    python3 generate.py <swagger.yaml> <output SKILL.md>
"""

import sys
import yaml


def resolve_ref(ref: str, schemas: dict) -> dict:
    name = ref.split("/")[-1]
    return schemas.get(name, {})


def extract_body_fields(details: dict, schemas: dict) -> str | None:
    rb = details.get("requestBody", {})
    if not rb:
        return None
    content = rb.get("content", {})
    for ct_info in content.values():
        schema = ct_info.get("schema", {})
        if "$ref" in schema:
            schema = resolve_ref(schema["$ref"], schemas)
        props = schema.get("properties", {})
        data = props.get("data", {})
        if not data:
            continue
        if "$ref" in data:
            data = resolve_ref(data["$ref"], schemas)
        desc = data.get("description", "")
        data_props = data.get("properties", {})
        data_required = data.get("required", [])
        if data_props:
            fields = ", ".join(
                f"{k}{'*' if k in data_required else ''}"
                for k in data_props
            )
            return f"  data: {{ {fields} }}"
        if desc:
            # Description encodes field names inline, e.g. "attrs (foo, bar)"
            return f"  data: {{ {desc} }}"
    return None


def extract_query_params(path_level: list, method_level: list) -> str | None:
    all_params = path_level + method_level
    query = [p["name"] for p in all_params if p.get("in") == "query"]
    if not query:
        return None
    return "(" + ", ".join(query) + ")"


def build_skill(spec: dict) -> str:
    schemas = spec.get("components", {}).get("schemas", {})
    paths = spec.get("paths", {})

    # Group endpoints by tag
    groups: dict[str, list[str]] = {}
    for path, methods in sorted(paths.items()):
        path_params = methods.get("parameters", [])
        for method, details in methods.items():
            if method == "parameters" or not isinstance(details, dict):
                continue
            tags = details.get("tags", ["General"])
            tag = tags[0]
            summary = details.get("summary", "")
            method_params = details.get("parameters", [])
            qp = extract_query_params(path_params, method_params)
            body = extract_body_fields(details, schemas)

            line = f"{method.upper():<7} {path}"
            if summary:
                suffix = f"  # {summary}"
                if qp:
                    suffix += f" {qp}"
                line += suffix
            elif qp:
                line += f"  {qp}"

            entry = line
            if body:
                entry += f"\n{body}"

            groups.setdefault(tag, []).append(entry)

    sections = []
    for tag in sorted(groups):
        block = "\n".join(groups[tag])
        sections.append(f"### {tag}\n\n```\n{block}\n```")

    endpoints_body = "\n\n".join(sections)

    return f"""\
---
name: api-reference
description: >
  Reference for The RPG Club API endpoints. Use when writing or reviewing code that calls the
  API, when asked what endpoints exist, or when choosing which endpoint to use for a feature.
  This is a read-only reference skill -- it does not perform actions.
---

The RPG Club API is a Rails JSON API. The bot authenticates with a bearer service token.

## Client helpers (src/services/RpgClubApiClient.ts)

```ts
apiGet<T>(path, config?)          // GET; returns T | null (null on 404)
apiGetRaw<T>(path, config?)       // GET; returns full metadata, never throws on 4xx/5xx
apiPost<T>(path, body?, config?)  // POST; returns T | null (null on 404)
apiPatch<T>(path, body?, config?) // PATCH; returns T | null (null on 404)
apiDelete<T>(path, config?)       // DELETE; returns T | null (null on 404)
```

All throw on non-404 errors. Pass query params via `config: {{ params: {{ ... }} }}`.

## Environment variables

- `RPGCLUB_API_BASE_URL` -- base URL (production: `https://therpgclub.fly.dev`)
- `RPGCLUB_BOT_API_TOKEN` -- bearer token sent as `Authorization: Bearer <token>`

## Request body envelope

Write endpoints expect: `{{ data: {{ <attributes> }} }}`

## Response envelope

List responses: `{{ data: [...], meta: {{ page, pages, count, per, prev, next }} }}`
Single responses: `{{ data: {{ ... }} }}`
Deletes: `{{ deleted: true }}`

## Common query params (list endpoints)

`page`, `per`, `limit`, `offset` -- standard pagination. `q` for search where supported.

## PUT vs PATCH

PUT endpoints are aliases for PATCH. Prefer PATCH.

## Self-update

When asked to refresh this reference or when the API may have changed:

```bash
bash .claude/skills/api-reference/refresh.sh
```

Then commit and push the updated `SKILL.md`:

```bash
git add .claude/skills/api-reference/SKILL.md
git commit -m "chore: refresh api-reference skill from latest swagger spec"
git push
```

Source spec: `swagger/v1/swagger.yaml` in https://github.com/TheRPGClub/TheRPGClub

---

## Endpoints by group

{endpoints_body}

---

## Source references

- Swagger spec: `swagger/v1/swagger.yaml` in https://github.com/TheRPGClub/TheRPGClub
- Live Swagger UI: https://therpgclub.fly.dev/api-docs/index.html
- Bot client: `src/services/RpgClubApiClient.ts`
"""


def main() -> None:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <swagger.yaml> <output SKILL.md>", file=sys.stderr)
        sys.exit(1)

    swagger_path, output_path = sys.argv[1], sys.argv[2]

    with open(swagger_path) as f:
        spec = yaml.safe_load(f)

    content = build_skill(spec)

    with open(output_path, "w") as f:
        f.write(content)

    print(f"Written: {output_path}")


if __name__ == "__main__":
    main()
