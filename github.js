const API = "https://api.github.com";
const BRANCH = "main";
const WORKFLOW = "pipeline.yml";
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function missingPermission(path, method) {
  const access = method === "GET" ? "Read" : "Read and write";
  if (path.includes("/actions/")) return `Actions (${access})`;
  if (path.includes(".github/workflows")) return "Workflows (Read and write)";
  return `Contents (${access})`;
}

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  constructor(token, repo) {
    this.token = token;
    this.repo = repo;
    [this.owner, this.name] = repo.split("/");
  }

  async request(path, { method = "GET", body, accept, raw } = {}) {
    const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).message || message;
      } catch {}
      if (res.status === 403 && /not accessible/i.test(message)) {
        message = `Tokenilta puuttuu oikeus: ${missingPermission(path, method)}. ` +
          "Lisää se GitHubissa: Settings → Developer settings → Fine-grained tokens → token → Edit.";
      }
      throw new GitHubError(res.status, message);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  repoInfo() {
    return this.request(`/repos/${this.repo}`);
  }

  async readText(path, ref = BRANCH) {
    try {
      const data = await this.request(`/repos/${this.repo}/contents/${path}?ref=${ref}`);
      return { text: decodeBase64(data.content), sha: data.sha };
    } catch (err) {
      if (err.status === 404) return { text: null, sha: null };
      throw err;
    }
  }

  async readJSON(path) {
    const { text, sha } = await this.readText(path);
    return { data: text ? JSON.parse(text) : null, sha };
  }

  writeText(path, text, sha, message) {
    return this.request(`/repos/${this.repo}/contents/${path}`, {
      method: "PUT",
      body: { message, content: encodeBase64(text), branch: BRANCH, ...(sha ? { sha } : {}) },
    });
  }

  writeJSON(path, data, sha, message) {
    return this.writeText(path, JSON.stringify(data, null, 2) + "\n", sha, message);
  }

  /** Read-modify-write that retries when the pipeline changed the file meanwhile. */
  async updateJSON(path, mutate, message) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, sha } = await this.readJSON(path);
      const next = mutate(data);
      try {
        await this.writeJSON(path, next, sha, message);
        return next;
      } catch (err) {
        if (err.status !== 409 && err.status !== 422) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw new Error("Tallennus epäonnistui: tiedostoa muokattiin samaan aikaan. Yritä uudelleen.");
  }

  async listDirectoryJSON(directory) {
    const query = `query($owner: String!, $name: String!, $expr: String!) {
      repository(owner: $owner, name: $name) {
        object(expression: $expr) { ... on Tree { entries { name oid object { ... on Blob { text } } } } }
      }
    }`;
    const res = await this.request("/graphql", {
      method: "POST",
      body: { query, variables: { owner: this.owner, name: this.name, expr: `${BRANCH}:${directory}` } },
    });
    if (res.errors) throw new Error(res.errors[0].message);
    const entries = res.data?.repository?.object?.entries || [];
    return entries
      .filter((e) => e.name.endsWith(".json") && e.object?.text)
      .map((e) => JSON.parse(e.object.text));
  }

  async listFiles(directory) {
    try {
      return await this.request(`/repos/${this.repo}/contents/${directory}?ref=${BRANCH}`);
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  dispatch(command, item = "") {
    return this.request(`/repos/${this.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: { ref: BRANCH, inputs: { command, item } },
    });
  }

  async runs(perPage = 25) {
    try {
      const data = await this.request(`/repos/${this.repo}/actions/workflows/${WORKFLOW}/runs?per_page=${perPage}`);
      return data.workflow_runs;
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  async videoUrl(itemId) {
    const res = await this.request(`/repos/${this.repo}/contents/media/${itemId}.mp4?ref=media`, {
      accept: "application/vnd.github.raw",
      raw: true,
    });
    return URL.createObjectURL(await res.blob());
  }
}
