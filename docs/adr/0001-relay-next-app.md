# Relay serves Login and the Host list as its own Next.js app

Login and the Host list are pages the Relay serves, not a separate product. They live in a Next.js app under `packages/cursor-remote-relay` so Relay install still does not ship the Host Next.js tarball. Visual language is the Host color tokens (copied into the Relay app so publish stays self-contained) and type; layout is prototype C (splash Login, empty Host list, Logout). The Host Token page stays as-is (upstream).

**Considered options:** string-built HTML in the Relay HTTP server (rejected: does not match Host style and is unmaintainable); one Next.js codebase with two bins (rejected: would drag the Host tarball into Relay install); a private workspace package for tokens (rejected: twenty CSS variables, not worth a third package).
