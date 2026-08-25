import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Architecture Boundary & Dependency Direction Tests (Phase 21B.3)", () => {
  const getTsFiles = (dir: string): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getTsFiles(fullPath));
      } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
    return results;
  };

  const srcDir = path.resolve(__dirname, "../../");

  it("Core Engine and Domain must NOT import UI or React packages (domain, engine/rules, engine/decision, engine/session, engine/simulation)", () => {
    const targetDirs = [
      path.resolve(srcDir, "domain"),
      path.resolve(srcDir, "engine/rules"),
      path.resolve(srcDir, "engine/decision"),
      path.resolve(srcDir, "engine/session"),
      path.resolve(srcDir, "engine/simulation"),
    ];

    const forbiddenPatterns = [
      /from\s+['"].*\/ui(\/.*)?['"]/,
      /from\s+['"]react['"]/,
      /from\s+['"]react-dom['"]/,
    ];

    const violations: Array<{ file: string; match: string }> = [];

    for (const dir of targetDirs) {
      const files = getTsFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        for (const pattern of forbiddenPatterns) {
          const match = content.match(pattern);
          if (match) {
            violations.push({
              file: path.relative(srcDir, file),
              match: match[0],
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("CLI and Simulation must NOT import BrowserRuleLoader directly", () => {
    const targetDirs = [
      path.resolve(srcDir, "cli"),
      path.resolve(srcDir, "engine/simulation"),
    ];

    const forbiddenPatterns = [
      /from\s+['"].*BrowserRuleLoader.*['"]/,
    ];

    const violations: Array<{ file: string; match: string }> = [];

    for (const dir of targetDirs) {
      const files = getTsFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        for (const pattern of forbiddenPatterns) {
          const match = content.match(pattern);
          if (match) {
            violations.push({
              file: path.relative(srcDir, file),
              match: match[0],
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
