import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1>This page does not exist</h1>
      <p className="note">The market or route could not be found.</p>
      <Link className="btn" href="/">Back to markets</Link>
    </div>
  );
}
