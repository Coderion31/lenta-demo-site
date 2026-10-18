import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FEEDS = [
  { name: "РИА Новости", topic: "Политика", url: "https://ria.ru/export/rss2/archive/index.xml" },
  { name: "ТАСС", topic: "Политика", url: "https://tass.ru/rss/v2.xml" },
  { name: "РБК", topic: "Экономика", url: "https://rssexport.rbc.ru/rbcnews/news/30/full.rss" },
  { name: "Лента.ру", topic: "Общество", url: "https://lenta.ru/rss/news" },
  { name: "Известия", topic: "Политика", url: "https://iz.ru/rss" },
  { name: "Коммерсантъ", topic: "Экономика", url: "https://www.kommersant.ru/rss/news.xml" },
  { name: "Ведомости", topic: "Экономика", url: "https://www.vedomosti.ru/rss/news" },
  { name: "RT", topic: "Мир", url: "https://russian.rt.com/rss" },
  { name: "Взгляд", topic: "Политика", url: "https://vz.ru/rss.xml" },
  { name: "МК", topic: "Общество", url: "https://www.mk.ru/rss/index.xml" },
  { name: "News.ru", topic: "Общество", url: "https://news.ru/rss/" },
  { name: "BFM.ru", topic: "Экономика", url: "https://www.bfm.ru/news.rss" },
  { name: "Москва 24", topic: "Город", url: "https://www.m24.ru/rss.xml" },
  { name: "Газета.Ru · Политика", topic: "Политика", url: "https://www.gazeta.ru/export/rss/politics.xml" },
  { name: "Газета.Ru · Общество", topic: "Общество", url: "https://www.gazeta.ru/export/rss/social.xml" },
  { name: "Газета.Ru · Спорт", topic: "Спорт", url: "https://www.gazeta.ru/export/rss/sport.xml" },
  { name: "Газета.Ru · Культура", topic: "Культура", url: "https://www.gazeta.ru/export/rss/culture.xml" },
  { name: "Газета.Ru · Наука", topic: "Наука", url: "https://www.gazeta.ru/export/rss/science.xml" },
  { name: "Газета.Ru · Авто", topic: "Авто", url: "https://www.gazeta.ru/export/rss/auto.xml" },
  { name: "3DNews", topic: "Технологии", url: "https://3dnews.ru/news/rss/" },
  { name: "Хабр", topic: "Технологии", url: "https://habr.com/ru/rss/news/" },
  { name: "N+1", topic: "Наука", url: "https://nplus1.ru/rss" },
  { name: "Афиша Daily", topic: "Культура", url: "https://daily.afisha.ru/rss/" }
];

const MAX_PER_FEED = 5;
const MAX_TOTAL = 60;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const v = ENTITIES[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function cleanText(s) {
  return decodeEntities(String(s || "").replace(/<!\[CDATA\[|\]\]>/g, ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const m = new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)</" + name + ">", "i").exec(xml);
  return m ? m[1] : "";
}

function decodeBody(buf, contentType) {
  const m = /charset=([^;]+)/i.exec(contentType || "");
  let charset = (m ? m[1] : "utf-8").trim().toLowerCase();
  if (charset === "cp1251" || charset === "windows-1251" || charset === "win-1251") charset = "windows-1251";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function shortText(s, n) {
  const t = cleanText(s);
  return t.length > n ? t.slice(0, n - 1).replace(/[\s,.;:—–-]+$/, "") + "…" : t;
}

async function loadFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = await res.arrayBuffer();
    const xml = decodeBody(buf, res.headers.get("content-type"));
    const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
    return items.slice(0, MAX_PER_FEED).map((raw) => {
      const title = cleanText(tag(raw, "title"));
      const link = cleanText(tag(raw, "link") || tag(raw, "guid"));
      const desc = cleanText(tag(raw, "description") || tag(raw, "summary"));
      const dateRaw = cleanText(tag(raw, "pubDate") || tag(raw, "dc:date"));
      const date = new Date(dateRaw);
      if (!title || !/^https?:\/\//i.test(link)) return null;
      return {
        title,
        url: link,
        source: feed.name,
        topic: feed.topic,
        published: Number.isFinite(date.getTime()) ? date.getTime() : Date.now(),
        excerpt: shortText(desc, 220)
      };
    }).filter(Boolean);
  } catch (e) {
    console.error("fail " + feed.name + ": " + e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(FEEDS.map(loadFeed));
const seen = new Set();
const items = [];
for (const list of results) {
  for (const item of list) {
    const key = item.url.replace(/[#?].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
}

items.sort((a, b) => b.published - a.published);

const bySource = new Map();
for (const item of items) {
  if (!bySource.has(item.source)) bySource.set(item.source, []);
  bySource.get(item.source).push(item);
}
const lists = [...bySource.values()];
const balanced = [];
let round = 0;
while (balanced.length < MAX_TOTAL && lists.some((l) => l.length)) {
  for (const list of lists) {
    if (!list.length) continue;
    const idx = list.findIndex((it) => !balanced.includes(it));
    if (idx === -1) continue;
    balanced.push(list.splice(idx, 1)[0]);
    if (balanced.length >= MAX_TOTAL) break;
  }
  round++;
  if (round > 20) break;
}
balanced.sort((a, b) => b.published - a.published);

const out = {
  updatedAt: new Date().toISOString(),
  sources: FEEDS.map((f) => f.name),
  items: balanced
};

const target = fileURLToPath(new URL("../data/news.json", import.meta.url));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(out, null, 1), "utf8");
console.log("items: " + out.items.length + " of " + items.length);
