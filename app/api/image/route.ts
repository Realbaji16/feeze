import { NextResponse } from "next/server";
import { IMAGE_BUCKET, putTokenImage, readTokenImage } from "@/lib/token-image";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("probe") === "1") {
    const payload = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const key = `${IMAGE_BUCKET}/probe`;
    let postStatus = 0;
    let postBody = "";
    let getStatus = 0;
    let getBody = "";
    try {
      const post = await fetch(`https://kvdb.io/${key}?ttl=600`, { method: "POST", cache: "no-store", body: payload });
      postStatus = post.status;
      postBody = (await post.text()).slice(0, 180);
    } catch (error) {
      postBody = error instanceof Error ? error.message : "post failed";
    }
    try {
      const get = await fetch(`https://kvdb.io/${key}`, { cache: "no-store" });
      getStatus = get.status;
      getBody = (await get.text()).slice(0, 120);
    } catch (error) {
      getBody = error instanceof Error ? error.message : "get failed";
    }
    return NextResponse.json({ postStatus, postBody, getStatus, getBody }, { headers });
  }
  const address = url.searchParams.get("address") ?? "";
  try {
    const image = await readTokenImage(address);
    return NextResponse.json({ image }, { headers });
  } catch {
    return NextResponse.json({ image: null }, { headers });
  }
}

export async function POST(request: Request) {
  let body: { address?: string; image?: string };
  try {
    body = (await request.json()) as { address?: string; image?: string };
  } catch {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  if (!body.address || !body.image) {
    return NextResponse.json({ error: "Expected an image" }, { status: 400, headers });
  }
  try {
    const result = await putTokenImage(body.address, body.image);
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save image";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
