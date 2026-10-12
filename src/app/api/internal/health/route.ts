import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";

export async function GET() {
  try {
    await connectDB();
    await mongoose.connection.db!.admin().ping();
    return NextResponse.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
