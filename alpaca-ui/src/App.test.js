import { render, screen } from "@testing-library/react";
import App from "./App";

const mockFetch = (url) => {
  const ok = true;
  const json = async () => {
    if (url.includes("/logs")) return { logs: [] };
    if (url.includes("/discovered")) return { symbols: [] };
    if (url.includes("/positions")) return { positions: [] };
    if (url.includes("/orders")) return { orders: [] };
    if (url.includes("/trade_history")) return { trades: [] };
    if (url.includes("/status")) return { status: "Stopped" };
    if (url.includes("/progress")) return { percent: 0, eta: "N/A", status: "Idle" };
    if (url.includes("/account"))
      return { cash: null, invested: null, buying_power: null, equity: null };
    if (url.includes("/sms/status")) return { enabled: false };
    return {};
  };
  return Promise.resolve({ ok, json });
};

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn(mockFetch);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.resetAllMocks();
});

test("renders CAIMEO title", async () => {
  render(<App />);
  const headings = await screen.findAllByText(/CAIMEO/i);
  expect(headings.length).toBeGreaterThan(0);
});
