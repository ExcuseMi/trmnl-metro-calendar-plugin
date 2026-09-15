# The Metro Calendar relay

Fetches one calendar feed and hands back its text, with a CORS header, so
the [configuration editor](../tools/config-editor.html) can read a calendar
the browser refuses to.

## Why it exists

A calendar feed sends no `Access-Control-Allow-Origin`, so a web page cannot
read one: the editor's fetch is refused by the browser before it leaves. No
AI assistant can fetch one either. Without this there are two routes, both
manual -- download the `.ics` and paste it in, or paste it into the chat --
and a configuration tool that tells the person it is meant to be helping
that it cannot read their calendars.

## What it holds, and what it does about it

A calendar link is a password in a URL. Google calls it a "secret address";
anyone holding it can read that calendar until it is regenerated.

* **Nothing carrying a URL is logged.** Not the query string, not the path,
  not the Referer. A log line here is a copy of somebody's calendar key in a
  file, and in every backup of that file. `/health` reports counts.
* **Nothing is stored.** No cache, no disk, no database.
* **Consent is asked for first**, in the editor, with the exact links it
  would send listed and whose server it is named. It is never a default.
  "Do not ask again on this device" is remembered in that browser only, and
  the editor says under the map each time it reads through the relay, with
  a button to stop.
* **Cloudflare is in front of it**, so its logs are the one place a request
  could be recorded that this project does not control.

## It is not an open proxy

`https` only, port 443 only. Every address a hostname resolves to must be on
the public internet, so `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254` and the
rest are refused -- and the check runs again on each redirect, because a
public URL that redirects to a metadata service is the same attack one hop
later. At most 3 redirects, 12s, 4MB. The answer must contain
`BEGIN:VCALENDAR`, so an error page cannot be stored by the editor as a feed
with no events.

## Running it

    docker compose up -d --build

Listens on `${PORT:-8760}` -> 8080 in the container. Put it behind the
Caddy route in `caddy-route.txt`.
