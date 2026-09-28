#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const artifact = realpathSync(resolve(process.argv[2] || "public"));
const screenshotDirectory = resolve(
  process.argv[3] || join(tmpdir(), "utana-launch-screenshots"),
);
function cachedHeadlessChromes() {
  const roots = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ];
  const candidates = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root).sort().reverse()) {
      if (!directory.startsWith("chromium_headless_shell-")) continue;
      candidates.push(
        join(
          root,
          directory,
          "chrome-headless-shell-mac-arm64",
          "chrome-headless-shell",
        ),
        join(root, directory, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      );
    }
  }
  return candidates;
}

const chromeCandidates = [
  process.env.CHROME_BIN,
  ...cachedHeadlessChromes(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find(existsSync);

if (!chrome) {
  throw new Error(
    "Chrome or Chromium was not found. Set CHROME_BIN to run browser smoke tests.",
  );
}

mkdirSync(screenshotDirectory, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "utana-chrome-"));
const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-crash-reporter",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-features=Translate",
    "--disable-gpu",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-sandbox",
    "--no-zygote",
    "--remote-debugging-pipe",
    "--single-process",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

class Protocol {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    output.setEncoding("utf8");
    output.on("data", (chunk) => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer += chunk;
    let separator;
    while ((separator = this.buffer.indexOf("\0")) !== -1) {
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        continue;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        Promise.resolve(listener(message.params || {}, message.sessionId)).catch(
          (error) => {
            failures.push(`event ${message.method}: ${error.message}`);
          },
        );
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 15000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.input.write(`${JSON.stringify(message)}\0`);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  once(method, predicate = () => true) {
    return new Promise((resolvePromise) => {
      const listener = (params, sessionId) => {
        if (!predicate(params, sessionId)) return;
        const listeners = this.listeners.get(method) || [];
        this.listeners.set(
          method,
          listeners.filter((candidate) => candidate !== listener),
        );
        resolvePromise(params);
      };
      this.on(method, listener);
    });
  }
}

const failures = [];
const protocol = new Protocol(child.stdio[3], child.stdio[4]);
const origin = "http://utana.test";
const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function main() {
  const { targetId } = await protocol.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await protocol.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params = {}) => protocol.send(method, params, sessionId);
  const consoleErrors = [];
  const localRequestFailures = [];
  const responseStatuses = new Map();

  protocol.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const url = new URL(request.url);
    if (url.origin !== origin) {
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 204,
        responseHeaders: [{ name: "Cache-Control", value: "no-store" }],
      });
      return;
    }

    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relativePath) relativePath = "index.html";
    let status = 200;
    let file = resolve(artifact, relativePath);
    const insideArtifact =
      file === artifact || file.startsWith(`${artifact}${sep}`);
    if (!insideArtifact || !existsSync(file)) {
      status = 404;
      file = join(artifact, "404.html");
    }
    const body = readFileSync(file).toString("base64");
    await send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [
        {
          name: "Content-Type",
          value: mimeTypes.get(extname(file).toLowerCase()) || "application/octet-stream",
        },
        { name: "Cache-Control", value: "no-store" },
      ],
      body,
    });
  });
  protocol.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    consoleErrors.push(exceptionDetails.text || "Uncaught runtime exception");
  });
  protocol.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") {
      consoleErrors.push(
        args.map((argument) => argument.value || argument.description).join(" "),
      );
    }
  });
  protocol.on("Network.loadingFailed", ({ requestId, errorText }) => {
    localRequestFailures.push(`${requestId}: ${errorText}`);
  });
  protocol.on("Network.responseReceived", ({ response }) => {
    if (response.url.startsWith(origin)) {
      responseStatuses.set(new URL(response.url).pathname, response.status);
    }
  });

  await Promise.all(
    ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map((method) =>
      send(method),
    ),
  );
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      globalThis.__launchCLS = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) globalThis.__launchCLS += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    `,
  });

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || `Evaluation failed: ${expression}`);
    }
    return result.result.value;
  }

  async function navigate(path) {
    const loaded = protocol.once(
      "Page.loadEventFired",
      (_params, eventSession) => eventSession === sessionId,
    );
    await send("Page.navigate", { url: `${origin}${path}` });
    await loaded;
    await sleep(250);
  }

  async function press(key, code = key) {
    const virtualKeyCodes = { Enter: 13, Escape: 27, Tab: 9 };
    const virtualKeyCode = virtualKeyCodes[key] || 0;
    const parameters = {
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    if (key === "Enter") {
      parameters.text = "\r";
      parameters.unmodifiedText = "\r";
    }
    await send("Input.dispatchKeyEvent", {
      type: key === "Enter" ? "keyDown" : "rawKeyDown",
      ...parameters,
    });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...parameters });
  }

  async function clickSelector(selector) {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`Cannot click missing selector: ${selector}`);
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      x: point.x,
      y: point.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      x: point.x,
      y: point.y,
    });
  }

  async function inspectPage(label) {
    await evaluate(`Promise.race([
      Promise.all([...document.images].map((image) => {
        image.loading = "eager";
        if (image.complete) return undefined;
        return new Promise((resolveImage) => {
          image.addEventListener("load", resolveImage, { once: true });
          image.addEventListener("error", resolveImage, { once: true });
        });
      })),
      new Promise((resolveImages) => setTimeout(resolveImages, 2000)),
    ])`);
    const result = await evaluate(`(() => ({
      title: document.title,
      h1: document.querySelector("h1")?.textContent.trim() || "",
      brokenImages: [...document.images]
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cls: globalThis.__launchCLS || 0,
    }))()`);
    assert(result.title, `${label}: missing document title`);
    assert(result.h1, `${label}: missing primary heading`);
    assert(result.brokenImages.length === 0, `${label}: broken images: ${result.brokenImages.join(", ")}`);
    assert(!result.horizontalOverflow, `${label}: horizontal page overflow detected`);
    assert(result.cls < 0.1, `${label}: cumulative layout shift was ${result.cls}`);
  }

  async function screenshot(name) {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    writeFileSync(join(screenshotDirectory, name), Buffer.from(data, "base64"));
  }

  async function inspectMobileNavigation(label) {
    const state = await evaluate(`(() => {
      const menu = document.querySelector(".menu");
      const nav = document.querySelector("#nav");
      return {
        menuVisible: getComputedStyle(menu).display !== "none",
        expanded: menu.getAttribute("aria-expanded"),
        navVisible: getComputedStyle(nav).visibility === "visible",
        navInert: nav.inert,
      };
    })()`);
    assert(state.menuVisible, `${label}: menu control is not visible`);
    assert(state.expanded === "false", `${label}: menu did not initialise closed`);
    assert(!state.navVisible, `${label}: closed navigation remained visible`);
    assert(state.navInert, `${label}: hidden navigation remained keyboard accessible`);
  }

  async function inspectResponsiveContent(label) {
    const result = await evaluate(`(() => {
      const cta = document.querySelector(".hero-bottom .button");
      const portraits = [...document.querySelectorAll(".member-portrait img")];
      const sources = [...document.querySelectorAll(".member-portrait source")];
      const rect = cta.getBoundingClientRect();
      return {
        ctaFits: rect.left >= -1 && rect.right <= innerWidth + 1 && cta.scrollWidth <= cta.clientWidth + 1,
        portraitsRendered: portraits.every((image) => image.complete && image.naturalWidth > 0),
        portraitHintsValid: [...portraits, ...sources].every((image) => image.sizes === "(max-width: 600px) 180px, 220px"),
      };
    })()`);
    assert(result.ctaFits, `${label}: primary CTA clips or overflows`);
    assert(result.portraitsRendered, `${label}: one or more team portraits did not render`);
    assert(result.portraitHintsValid, `${label}: team portrait sizes hints are invalid`);
  }

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate("/index.html");
  await inspectPage("desktop homepage");
  await inspectResponsiveContent("desktop homepage");
  await screenshot("desktop-home.png");
  assert(
    (await evaluate('document.querySelectorAll("#nav a").length')) >= 5,
    "desktop homepage: expected navigation links",
  );
  await clickSelector('#nav a[href="#consulting"]');
  assert(
    (await evaluate("location.hash")) === "#consulting",
    "desktop homepage: navigation link did not reach #consulting",
  );
  const socialMetadata = await evaluate(`(() => ({
    canonical: document.querySelector("link[rel=canonical]")?.href,
    ogUrl: document.querySelector('meta[property="og:url"]')?.content,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    ogDescription: document.querySelector('meta[property="og:description"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    ogImageType: document.querySelector('meta[property="og:image:type"]')?.content,
    ogSiteName: document.querySelector('meta[property="og:site_name"]')?.content,
    twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
    twitterTitle: document.querySelector('meta[name="twitter:title"]')?.content,
    twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content,
    twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
  }))()`);
  assert(socialMetadata.canonical === "https://utana.agentic.technologies/index.html", "homepage: canonical URL changed");
  assert(socialMetadata.ogUrl === "https://utana.agentic.technologies/index.html", "homepage: og:url changed");
  assert(socialMetadata.ogTitle === "Utana — Agentic Workflow Automation", "homepage: og:title is incorrect");
  assert(socialMetadata.ogDescription === "AI agents that automate repetitive workflows and help teams move faster.", "homepage: og:description is incorrect");
  assert(socialMetadata.twitterTitle === socialMetadata.ogTitle, "homepage: social titles do not match");
  assert(socialMetadata.twitterDescription === socialMetadata.ogDescription, "homepage: social descriptions do not match");
  assert(socialMetadata.ogImage === "https://utana-agentic-lp-v.vercel.app/assets/social/utana-social-preview.png", "homepage: og:image is incorrect");
  assert(socialMetadata.twitterImage === socialMetadata.ogImage, "homepage: social images do not match");
  assert(socialMetadata.ogImageType === "image/png", "homepage: og:image:type is missing");
  assert(socialMetadata.ogSiteName === "Utana", "homepage: og:site_name is missing");
  assert(socialMetadata.twitterCard === "summary_large_image", "homepage: Twitter card type changed");

  await navigate("/blog/first-workflow.html");
  await inspectPage("canonical blog article");
  await navigate("/use-cases/clinic-administration.html");
  await inspectPage("canonical use-case article");
  await navigate("/does-not-exist.html");
  await inspectPage("custom 404");
  assert(
    (await evaluate('document.querySelector("meta[name=robots]")?.content')) === "noindex",
    "custom 404: robots policy is not noindex",
  );
  assert(
    responseStatuses.get("/does-not-exist.html") === 404,
    "custom 404: response status was not 404",
  );

  await send("Emulation.setDeviceMetricsOverride", {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("/index.html");
  await inspectPage("tablet homepage");
  await inspectResponsiveContent("tablet homepage");
  await inspectMobileNavigation("tablet homepage");
  await screenshot("tablet-home.png");
  await evaluate('document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#insights").scrollIntoView()');
  await screenshot("tablet-insights.png");
  await evaluate('document.querySelector("#contact").scrollIntoView()');
  await screenshot("tablet-contact.png");
  await evaluate("scrollTo(0, 0)");
  assert(
    await evaluate('getComputedStyle(document.querySelector(".blog-grid")).gridTemplateColumns.split(" ").length === 2'),
    "tablet homepage: insights did not switch to two columns",
  );
  assert(
    await evaluate('getComputedStyle(document.querySelector("#contact .split")).gridTemplateColumns.split(" ").length === 1'),
    "tablet homepage: contact split remained compressed",
  );
  await clickSelector(".menu");
  assert(
    await evaluate('document.querySelector("#nav").classList.contains("open") && !document.querySelector("#nav").inert'),
    "tablet menu: navigation did not open",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(100);
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "false" && !document.querySelector("#nav").classList.contains("open") && !document.querySelector("#nav").inert && getComputedStyle(document.querySelector("#nav")).visibility === "visible"'),
    "responsive menu: state was not reconciled at the desktop breakpoint",
  );

  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("/index.html");
  await inspectPage("narrow mobile homepage");
  await inspectResponsiveContent("narrow mobile homepage");
  await inspectMobileNavigation("narrow mobile homepage");
  await screenshot("narrow-mobile-home.png");
  await evaluate('document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#insights").scrollIntoView()');
  await screenshot("narrow-mobile-insights.png");
  await evaluate("scrollTo(0, 0)");
  assert(
    await evaluate('document.querySelector("#workflow-background")?.dataset.animationMode === "limited"'),
    "narrow mobile homepage: decorative canvas was not limited",
  );
  await clickSelector(".menu");
  await clickSelector(".menu");
  assert(
    await evaluate('document.querySelector("#nav").inert && document.querySelector(".menu").getAttribute("aria-expanded") === "false"'),
    "narrow mobile menu: closed state remained interactive",
  );

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("/index.html");
  await inspectPage("mobile homepage");
  await inspectResponsiveContent("mobile homepage");
  await inspectMobileNavigation("mobile homepage");
  await screenshot("mobile-home.png");
  await clickSelector(".menu");
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "true" && document.querySelector("#nav").classList.contains("open")'),
    "mobile menu: pointer activation did not open navigation",
  );
  await clickSelector(".menu");
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "false" && !document.querySelector("#nav").classList.contains("open")'),
    "mobile menu: pointer activation did not close navigation",
  );
  await evaluate('document.querySelector(".menu").focus()');
  await press("Enter");
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "true" && document.activeElement === document.querySelector("#nav a")'),
    "mobile menu: keyboard activation did not open and move focus",
  );
  const focusVisible = await evaluate(`(() => {
    const style = getComputedStyle(document.activeElement);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  })()`);
  assert(focusVisible, "mobile menu: keyboard focus is not visibly styled");
  await press("Enter");
  await sleep(100);
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "false" && document.querySelector("#nav").inert && document.activeElement === document.querySelector(".menu")'),
    "mobile menu: keyboard link activation left focus inside hidden navigation",
  );
  await press("Enter");
  await press("Escape");
  assert(
    await evaluate('document.querySelector(".menu").getAttribute("aria-expanded") === "false" && document.activeElement === document.querySelector(".menu")'),
    "mobile menu: Escape did not close navigation and restore focus",
  );
  await navigate("/index.html");
  await press("Tab");
  assert(
    await evaluate('document.activeElement.classList.contains("skip")'),
    "skip link: first Tab did not focus the skip link",
  );
  await press("Enter");
  await sleep(100);
  assert(
    await evaluate('location.hash === "#main" && document.activeElement === document.querySelector("#main")'),
    "skip link: activation did not move focus to main content",
  );
  const emailTargets = await evaluate(`(() => ({
    address: document.querySelector("a.email")?.href || "",
    cta: document.querySelector(".email-cta a.button")?.href || "",
    fallback: document.querySelector(".email-address")?.textContent.trim() || "",
  }))()`);
  assert(
    emailTargets.address === "mailto:sapiens@utana.group",
    `email address: unexpected target ${emailTargets.address}`,
  );
  assert(
    emailTargets.cta === "mailto:sapiens@utana.group?subject=Early%20automation%20pilot%20application",
    `email CTA: unexpected target ${emailTargets.cta}`,
  );
  assert(
    emailTargets.fallback === "sapiens@utana.group",
    "email CTA: copyable fallback address is missing",
  );

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await navigate("/index.html");
  assert(
    await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches && !document.querySelector(".reveal-ready")'),
    "reduced motion: reveal animation setup was not disabled",
  );
  assert(
    await evaluate('document.querySelector("#workflow-background")?.dataset.animationMode === "static" && getComputedStyle(document.querySelector(".workflow-heart")).animationName === "none"'),
    "reduced motion: decorative treatment remained animated",
  );
  await evaluate("scrollTo(0, 700)");
  await sleep(100);
  assert(
    (await evaluate('document.querySelector(".orbit-art")?.style.getPropertyValue("--orbit-shift") || ""')) === "",
    "reduced motion: decorative orbit movement remained active",
  );

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });`,
  });
  await navigate("/index.html");
  assert(
    await evaluate('document.body.classList.contains("save-data") && document.querySelector("#workflow-background")?.dataset.animationMode === "static" && getComputedStyle(document.querySelector(".workflow-heart")).animationName === "none"'),
    "save-data: decorative treatment was not reduced to a static state",
  );

  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
  assert(
    localRequestFailures.length === 0,
    `failed resource requests: ${localRequestFailures.join(" | ")}`,
  );

  if (failures.length) {
    throw new Error(`Browser smoke failed:\n- ${failures.join("\n- ")}`);
  }
  console.log(
    `Browser smoke passed (desktop 1440x1000, tablet 768x1024, mobile 390x844, narrow mobile 320x700). Screenshots: ${screenshotDirectory}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      sleep(1000),
    ]);
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
