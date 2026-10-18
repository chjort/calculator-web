import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has no canvas; axe probes it for icon ligatures. Contrast is verified in e2e (real browser).
HTMLCanvasElement.prototype.getContext = () => null;
