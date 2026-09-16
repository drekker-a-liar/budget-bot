# Privacy Policy Template

> **This is a template, not legal advice.** It describes what a stock
> Budget Bot deployment actually does with data, in first person, so a
> self-hoster can publish it after filling in the brackets. If your
> deployment diverges from stock — extra integrations, extra users, another
> hosting arrangement — the template does not know that, and a lawyer is
> the only upgrade path this file can recommend.

Why publish one at all, for a single-user tool: Plaid's Production review
asks for an end-user privacy policy URL, banks' OAuth consent screens may
display it, and writing it is ten minutes once the blanks are yours.

---

# Privacy Policy — [deployment name]

_Last updated: [date]_

This is a private, self-hosted financial dashboard operated by
[your name/business name] for its own use. It has no public sign-up, no
customers, and no users other than [me / the people named below].

## What it stores

- **Bank transaction data** for accounts I connect: dates, amounts,
  merchant descriptions, and account names, retrieved through Plaid Inc.
- **Business records I enter myself**: projects, invoices, labor entries.
- **Sign-in identity**: the email address and profile image of the GitHub
  account(s) allowed to sign in, and session records.

It stores **no card numbers** and **no bank credentials** — sign-in to a
bank happens on the bank's or Plaid's own pages; this application receives
an access token, which it stores encrypted.

## Where it lives

Data is stored in a PostgreSQL database at [Neon / Supabase / other host],
and the application runs at [Vercel / other host]. Both are accounts I
control. No analytics, advertising, or tracking services are embedded.

## Who else sees it

- **Plaid Inc.** connects to my bank(s) on my behalf; its handling of that
  data is governed by [Plaid's End User Privacy Policy](https://plaid.com/legal/#end-user-privacy-policy).
- **My hosting providers** ([Vercel / other], [Neon / other]) process the
  data as infrastructure, under their own terms.
- Nobody else. The data is not sold, shared, or used for anything beyond
  displaying my own finances to me.

## How long it is kept, and how it is deleted

Data is kept until I delete it. The application's settings page can
disconnect a bank (which invalidates its access token at Plaid) and can
export or permanently delete every stored record. Backups held by the
database host expire per that host's retention policy: [look it up and
state it].

## Contact

[your email or preferred contact], for the unlikely event this policy of
one has a second reader with a question.
