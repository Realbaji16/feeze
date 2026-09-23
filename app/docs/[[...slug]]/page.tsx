"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DOCS, getDoc } from "@/lib/docs";

export default function DocsPage() {
  const params = useParams<{ slug?: string[] }>();
  const slug = params.slug?.[0] ?? "";
  const page = getDoc(slug) ?? DOCS[0];
  return (
    <div className="docs">
      <aside>
        {DOCS.map((item) => (
          <Link key={item.slug || "home"} href={item.slug ? `/docs/${item.slug}` : "/docs"} className={item.slug === page.slug ? "on" : ""}>
            {item.title}
          </Link>
        ))}
      </aside>
      <article>
        <div className="faint">{page.kicker}</div>
        <h1>{page.title}</h1>
        <p>{page.summary}</p>
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <p className="note">Chain model 4663. Contract reads stay authoritative for balances, quotes, and claims.</p>
      </article>
    </div>
  );
}
