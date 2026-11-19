import { expect, test } from "@playwright/test";

test("admin signs in and sees the operations shell", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("admin@abc-facilities.example");
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD ?? "FieldOps-demo-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("ABC Facilities Management").first()).toBeVisible();
  await expect(page.getByText("Organization admin").first()).toBeVisible();
});
