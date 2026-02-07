import express from "express";
import cors from "cors";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { store } from "../store/sqlite-store.js";
import { startScan, stopScan, getActiveScan } from "./scan-manager.js";
import { generatePDFReport } from "../reports/pdf-generator.js";
import type { Scan } from "@strix-webui/shared";

export function createRestServer(port: number = 3000): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", activeScan: getActiveScan()?.scan.id || null });
  });

  // Start new scan
  app.post("/api/scans", (req, res) => {
    try {
      const { target, targetType, mode } = req.body;

      if (!target) {
        res.status(400).json({ error: "Target is required" });
        return;
      }

      // Auto-detect target type
      let type: Scan["targetType"] = targetType || "url";
      if (!targetType) {
        if (target.includes("github.com")) type = "github";
        else if (target.startsWith("/") || target.startsWith("./") || target.startsWith("~")) type = "local";
        else type = "url";
      }

      const scan = startScan(target, type, mode || "auto");
      res.json(scan);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(409).json({ error: message });
    }
  });

  // List scans
  app.get("/api/scans", (_req, res) => {
    const scans = store.getAllScans();
    res.json(scans);
  });

  // Get scan detail
  app.get("/api/scans/:id", (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);
    const vulnerabilities = store.getVulnsByScan(scan.id);
    const logs = store.getRecentLogs(scan.id, 200);

    res.json({ scan, agents, tools, vulnerabilities, logs });
  });

  // Stop scan
  app.delete("/api/scans/:id", (req, res) => {
    const success = stopScan(req.params.id);
    if (success) {
      res.json({ message: "Scan stopped" });
    } else {
      res.status(404).json({ error: "Active scan not found" });
    }
  });

  // Get scan report (PDF)
  app.get("/api/scans/:id/report", async (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const vulnerabilities = store.getVulnsByScan(scan.id);
    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);

    try {
      const pdfBuffer = await generatePDFReport(scan, vulnerabilities, agents, tools);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="strix-report-${scan.id.slice(0, 8)}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Report preview (JSON summary)
  app.get("/api/scans/:id/report/preview", (req, res) => {
    const scan = store.getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }

    const vulnerabilities = store.getVulnsByScan(scan.id);
    const agents = store.getAgentsByScan(scan.id);
    const tools = store.getToolsByScan(scan.id);

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const v of vulnerabilities) {
      severityCounts[v.severity]++;
    }

    res.json({
      scan,
      summary: {
        totalFindings: vulnerabilities.length,
        severityCounts,
        totalAgents: agents.length,
        totalTools: tools.length,
        duration: scan.completedAt && scan.startedAt
          ? new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()
          : null,
      },
      vulnerabilities,
    });
  });

  // Fetch truncated content
  app.get("/api/tools/content/:contentId", (req, res) => {
    const contentPath = join(homedir(), ".strix-webui", "content", `${req.params.contentId}.json`);
    if (!existsSync(contentPath)) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    try {
      const content = JSON.parse(readFileSync(contentPath, "utf-8"));
      res.json(content);
    } catch {
      res.status(500).json({ error: "Failed to read content" });
    }
  });

  app.listen(port, () => {
    console.log(`[REST] API server running on http://localhost:${port}`);
  });

  return app;
}
