import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as semver from "semver";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { pipeline } from "stream/promises";

const MINIMUM_CST_VERSION = "0.1.3";

interface Asset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: Asset[];
}

export class CstManager {
  private context: vscode.ExtensionContext;
  private storageUri: vscode.Uri;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.storageUri = context.globalStorageUri;
  }

  /**
   * Returns the path to the cst executable.
   * Tries to find it in global storage, otherwise downloads it.
   */
  public async get_exe(
    onStatus?: (
      status: "downloading" | "extracting" | "ready" | "error",
    ) => void,
  ): Promise<string | null> {
    // 1. Check if already exists in storage
    const localExe = await this.getLocalExePath();
    if (localExe && (await this.isValidExe(localExe))) {
      return localExe;
    }

    // 2. Try to download
    try {
      if (onStatus) onStatus("downloading");
      const downloadedExe = await this.downloadCst(onStatus);
      if (downloadedExe) {
        if (onStatus) onStatus("ready");
        return downloadedExe;
      }
    } catch (error) {
      console.error("Failed to download cst:", error);
      if (onStatus) onStatus("error");
      vscode.window.showErrorMessage(
        `Failed to download Codestory CLI: ${error}`,
      );
    }

    return null;
  }

  private async getLocalExePath(): Promise<string | null> {
    const platform = process.platform;
    const exeName = platform === "win32" ? "cst.exe" : "cst";

    if (!fs.existsSync(this.storageUri.fsPath)) {
      return null;
    }

    const dirs = fs.readdirSync(this.storageUri.fsPath);
    const versions = dirs
      .filter((d) => d.startsWith("v") && semver.valid(d.substring(1)))
      .map((d) => d.substring(1))
      .filter((v) => semver.gte(v, MINIMUM_CST_VERSION))
      .sort(semver.rcompare);

    if (versions.length > 0) {
      const bestVersion = versions[0];
      const exePath = path.join(
        this.storageUri.fsPath,
        `v${bestVersion}`,
        "cst",
        exeName,
      );
      if (fs.existsSync(exePath)) {
        return exePath;
      }
    }

    // Fallback for old structure (cst/cst.exe) - only if it's valid (we can't easily check version without running it, but user asked to check for any that match min_version or above)
    // If we can't check version, we should probably ignore the old structure if we want to be safe, or just keep it as a last resort if it exists.
    // But the user said "check for any that match min_version or above. You could use a folder for this. eg v0.1.1/exe, v0.1.2/exe."
    // So I'll stick to the versioned folders.

    return null;
  }

  private async isValidExe(exePath: string): Promise<boolean> {
    // For now, just check if it exists.
    // In a real scenario, we might want to check 'cst --version'
    return fs.existsSync(exePath);
  }

  private async downloadCst(
    onStatus?: (
      status: "downloading" | "extracting" | "ready" | "error",
    ) => void,
  ): Promise<string | null> {
    const releases = await this.fetchReleases();

    // Sort releases by version descending
    const sortedReleases = releases
      .filter((r) => semver.valid(r.tag_name.replace(/^v/, "")))
      .sort((a, b) =>
        semver.rcompare(
          a.tag_name.replace(/^v/, ""),
          b.tag_name.replace(/^v/, ""),
        ),
      );

    const latestRelease = sortedReleases.find((r) =>
      semver.gte(r.tag_name.replace(/^v/, ""), MINIMUM_CST_VERSION),
    );

    if (!latestRelease) {
      throw new Error(
        `No release found matching minimum version ${MINIMUM_CST_VERSION}`,
      );
    }

    const platform = process.platform;
    let assetName = "";
    if (platform === "win32") {
      assetName = "cst-windows-standalone.zip";
    } else if (platform === "darwin") {
      assetName = "cst-macos-standalone.tar.gz";
    } else if (platform === "linux") {
      assetName = "cst-linux-standalone.tar.gz";
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const asset = latestRelease.assets.find((a) => a.name === assetName);
    if (!asset) {
      throw new Error(
        `Asset ${assetName} not found in release ${latestRelease.tag_name}`,
      );
    }

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageUri.fsPath)) {
      await vscode.workspace.fs.createDirectory(this.storageUri);
    }

    const downloadPath = path.join(this.storageUri.fsPath, assetName);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading Codestory CLI ${latestRelease.tag_name}`,
        cancellable: false,
      },
      async (progress) => {
        const response = await fetch(asset.browser_download_url);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.statusText}`);
        }

        const fileStream = fs.createWriteStream(downloadPath);
        // @ts-ignore - fetch body is a ReadableStream in Node 18+
        await pipeline(response.body, fileStream);
      },
    );

    // Extract
    if (onStatus) onStatus("extracting");
    const versionDir = path.join(
      this.storageUri.fsPath,
      latestRelease.tag_name.startsWith("v")
        ? latestRelease.tag_name
        : `v${latestRelease.tag_name}`,
    );
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    await this.extract(downloadPath, versionDir);

    // Cleanup download
    fs.unlinkSync(downloadPath);

    return this.getLocalExePath();
  }

  private async fetchReleases(): Promise<Release[]> {
    const res = await fetch(
      "https://api.github.com/repos/CodeStoryBuild/CodeStoryCli/releases",
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch releases: ${res.statusText}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid response from GitHub API");
    }
    return data as Release[];
  }

  private async extract(filePath: string, destDir: string): Promise<void> {
    if (filePath.endsWith(".zip")) {
      const zip = new AdmZip(filePath);
      zip.extractAllTo(destDir, true);
    } else if (filePath.endsWith(".tar.gz")) {
      await tar.x({
        file: filePath,
        cwd: destDir,
      });
    }

    // On non-windows, ensure the binary is executable
    if (process.platform !== "win32") {
      const exePath = path.join(destDir, "cst", "cst");
      if (fs.existsSync(exePath)) {
        fs.chmodSync(exePath, "755");
      }
    }
  }
}
