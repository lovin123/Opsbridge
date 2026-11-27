import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "opsbridge-nexconn-writeup.html");
const pdfPath = path.join(__dirname, "Opsbridge-Nexconn-Writeup.pdf");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
});
await browser.close();
console.log(pdfPath);
