// Runs before every test file. `@testing-library/jest-dom` registers the DOM
// matchers (`toBeInTheDocument`, `toHaveAttribute`, ...); importing it in a
// node-environment file is harmless, it only extends `expect`.
import "@testing-library/jest-dom/vitest";
