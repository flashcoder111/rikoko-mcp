import {
  createServer,
  request as httpRequest,
  type OutgoingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { assertPublicIp } from "./download.js";
import { AppError } from "../../contracts/src/index.js";
import {
  configuredDownloadProxy,
  isSyntheticProxyAddress,
  resolveProxyDns,
} from "./download-network.js";

/** Per-download loopback transport. Every destination is checked and pinned,
 * including redirects and CDN requests made inside curl_cffi/FFmpeg. */
export async function openDownloadProxy(signal?: AbortSignal) {
  const sockets = new Set<Socket>();
  let failure: AppError | undefined;
  const configured = await configuredDownloadProxy();
  let upstream: URL | undefined;
  try {
    upstream = configured ? new URL(configured) : undefined;
  } catch {
    throw new AppError("DOWNLOAD_PROXY_INVALID", "下载代理地址无效。", 400);
  }
  const dns = new Map<string, Promise<{ address: string; family: number }>>();
  if (
    upstream &&
    (!["http:", "https:"].includes(upstream.protocol) ||
      upstream.pathname !== "/" ||
      upstream.search ||
      upstream.hash)
  )
    throw new AppError(
      "DOWNLOAD_PROXY_INVALID",
      "下载代理须为 HTTP(S) 代理地址。",
      400,
    );
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.setTimeout(30_000, () =>
      socket.destroy(Error("Download socket timeout")),
    );
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  async function destination(host: string, port: number) {
    if (![80, 443].includes(port))
      throw new AppError("UNSAFE_URL", "下载目标端口被阻止。");
    const addresses = await lookup(host.replace(/^\[|\]$/g, ""), { all: true });
    if (!addresses.length)
      throw new AppError("UNSAFE_URL", "下载目标没有可用地址。");
    if (
      upstream &&
      addresses.every((address) => isSyntheticProxyAddress(address.address))
    ) {
      let answer = dns.get(host);
      if (!answer) {
        answer = resolveProxyDns(host, dial, signal);
        dns.set(host, answer);
      }
      return answer;
    }
    for (const address of addresses) assertPublicIp(address.address);
    return addresses[0]!;
  }
  async function tunnel(host: string, port: number): Promise<Socket> {
    const address = await destination(host, port);
    return dial(address.address, port, address.family);
  }
  async function dial(
    address: string,
    port: number,
    family = 4,
  ): Promise<Socket> {
    if (signal?.aborted) throw new AppError("CANCELLED", "下载已取消。");
    if (!upstream)
      return new Promise((resolve, reject) => {
        const socket = track(connect({ host: address, port, family }));
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    return new Promise((resolve, reject) => {
      const target = `${family === 6 ? `[${address}]` : address}:${port}`;
      const headers: Record<string, string> = { Host: target };
      if (upstream.username || upstream.password)
        headers["Proxy-Authorization"] =
          `Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString("base64")}`;
      const request = (
        upstream.protocol === "https:" ? httpsRequest : httpRequest
      )({
        hostname: upstream.hostname,
        port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
        method: "CONNECT",
        path: target,
        headers,
        signal,
      });
      request.setTimeout(30_000, () => request.destroy(Error("Proxy timeout")));
      request.once("connect", (response, socket, head) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          reject(Error("Proxy connection failed"));
          return;
        }
        if (head.length) socket.unshift(head);
        resolve(track(socket));
      });
      request.once("error", reject);
      request.end();
    });
  }
  const remember = (error: unknown) => {
    failure =
      error instanceof AppError
        ? error
        : new AppError(
            "DOWNLOAD_NETWORK_FAILED",
            "本地下载连接失败，请检查网络或代理设置后重试。",
          );
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "");
      if (
        url.protocol !== "http:" ||
        url.username ||
        url.password ||
        !["GET", "HEAD"].includes(request.method ?? "")
      )
        throw new AppError("UNSAFE_URL", "下载请求被阻止。");
      const socket = await tunnel(url.hostname, Number(url.port || 80));
      // A supplied connection preserves the pinned destination through a user proxy.
      const { Agent } = await import("node:http");
      const agent = new Agent();
      agent.createConnection = () => socket;
      const headers: OutgoingHttpHeaders = {
        ...request.headers,
        host: url.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const outgoing = httpRequest(
        url,
        { method: request.method, headers, agent, signal },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
        },
      );
      outgoing.once("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.once("close", () => {
        outgoing.destroy();
        agent.destroy();
      });
      request.pipe(outgoing);
    } catch (error) {
      remember(error);
      response.writeHead(error instanceof AppError ? 403 : 502).end();
    }
  });
  server.on("connection", (socket) => {
    if (sockets.size >= 32) socket.destroy();
    else track(socket);
  });
  server.on("connect", async (request, client, head) => {
    try {
      const url = new URL(`https://${request.url}`);
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new AppError("UNSAFE_URL", "下载目标无效。");
      const remote = await tunnel(url.hostname, Number(url.port || 443));
      remote.on("error", () => client.destroy());
      client.on("error", () => remote.destroy());
      client.once("close", () => remote.destroy());
      remote.once("close", () => client.destroy());
      if (client.destroyed || signal?.aborted) {
        remote.destroy();
        return;
      }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      remote.pipe(client);
      client.pipe(remote);
    } catch (error) {
      remember(error);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const close = async () => {
    signal?.removeEventListener("abort", abort);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const abort = () => {
    for (const socket of sockets) socket.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close,
    failure: () => failure,
  };
}
