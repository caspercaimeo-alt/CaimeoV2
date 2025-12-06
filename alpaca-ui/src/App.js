import React, { useEffect, useState, useRef } from "react";
import "./App.css";

const resolveServerUrl = () => {
  const prodUrl = "https://api.caspercaimeo.com";
  const localUrl = "http://localhost:5000";

  if (process.env.REACT_APP_SERVER_URL) return process.env.REACT_APP_SERVER_URL;

  if (typeof window === "undefined") return prodUrl;
  if (window.__CAIMEO_API_BASE__) return window.__CAIMEO_API_BASE__;

  const host = window.location.hostname || "";
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal) return localUrl;

  const isProductionHost = host.endsWith("caspercaimeo.com") || host.endsWith("caimeov1.pages.dev");
  if (isProductionHost) return prodUrl;

  return prodUrl;
};

const SERVER = resolveServerUrl();

function App() {
  const [logs, setLogs] = useState("");
  const [status, setStatus] = useState("Stopped");
  const [discovered, setDiscovered] = useState([]);
  const [cardsToShow, setCardsToShow] = useState(16);
  const [portfolio, setPortfolio] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState({ cash: null, invested: null, buying_power: null, equity: null });
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [msg, setMsg] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [smsStatus, setSmsStatus] = useState({ enabled: false, phone: null, carrier: null });
  const [smsPhone, setSmsPhone] = useState("");
  const [smsNotice, setSmsNotice] = useState("");
  const [showSmsPrompt, setShowSmsPrompt] = useState(false);
  const [meta, setMeta] = useState({
    total_scanned: 10000,
    after_filters: 0,
    displayed: 0,
  });
  const [progress, setProgress] = useState({
    percent: 0,
    eta: "N/A",
    status: "Idle",
  });
  const [navOpen, setNavOpen] = useState(false);
  const [titleWidth, setTitleWidth] = useState(0);
  const logsBoxRef = useRef(null);
  const titleRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window === "undefined" ? false : window.innerWidth <= 768));

  const noCacheHeaders = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const fetchJson = async (path, options = {}) => {
    const response = await fetch(`${SERVER}${path}`, {
      cache: "no-store",
      ...options,
      headers: { ...noCacheHeaders, ...(options.headers || {}) },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  };

  const fetchSmsStatus = async () => {
    try {
      const data = await fetchJson("/sms/status");
      const enabled = Boolean(data.enabled);
      setSmsStatus({
        enabled,
        phone: data.phone || null,
        carrier: data.carrier || null,
      });
      if (authenticated && !enabled) {
        setShowSmsPrompt(true);
      }
      if (enabled) {
        setShowSmsPrompt(false);
      }
    } catch {
      setSmsStatus({ enabled: false, phone: null, carrier: null });
    }
  };

  const submitSmsSignup = async (e) => {
    e.preventDefault();
    setSmsNotice("Submitting...");
    try {
      const res = await fetch(`${SERVER}/sms/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...noCacheHeaders },
        body: JSON.stringify({ phone: smsPhone }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        const reason = data?.detail ? `: ${data.detail}` : "";
        throw new Error(`Unable to enable text alerts${reason}`);
      }
      setSmsStatus({ enabled: true, phone: data.phone || null, carrier: data.carrier || null });
      setShowSmsPrompt(false);
      setSmsNotice("✅ Text alerts enabled");
    } catch (err) {
      setSmsNotice(`❌ ${err.message || "Unable to enable text alerts"}`);
      console.error(err);
    }
  };

  async function fetchProgress() {
    try {
      const data = await fetchJson("/progress");
      setProgress({
        percent: data.percent || 0,
        eta: data.eta || "N/A",
        status: data.status || "Idle",
      });
    } catch {
      setProgress({ percent: 0, eta: "N/A", status: "Idle" });
    }
  }

  const computeCardsToShow = (width) => {
    if (width <= 768) return 9;
    const columns = Math.min(6, Math.max(1, Math.floor((width - 60) / 220)));
    return columns * 4;
  };

  async function fetchDiscovered() {
    try {
      const data = await fetchJson("/discovered");
      console.log("🔍 /discovered response:", data);
      const list = Array.isArray(data.symbols)
        ? data.symbols.filter(
            (s) =>
              !s.confidence ||
              s.confidence === "A" ||
              s.confidence === "B" ||
              s.confidence === "C"
          )
        : [];
      const sorted = list.sort((a, b) => {
        const order = { A: 3, B: 2, C: 1, D: 0, F: -1 };
        return (order[b.confidence] || 0) - (order[a.confidence] || 0);
      });
      setDiscovered(sorted);
      setMeta({
        total_scanned: 10000,
        after_filters: list.length,
        displayed: Math.min(computeCardsToShow(window.innerWidth), sorted.length),
      });
    } catch (err) {
      console.error("Failed to fetch discovered stocks:", err);
    }
  }

  async function submitKeys(e) {
    e.preventDefault();
    setMsg("Validating...");
    try {
      const data = await fetchJson("/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      if (data.valid) {
        setAuthenticated(true);
        setMsg("✅ Keys validated successfully");
        fetchPortfolio();
        fetchAccount();
      } else {
        setAuthenticated(false);
        setMsg("❌ Invalid API credentials");
      }
    } catch {
      setMsg("❌ Server error");
      setAuthenticated(false);
    }
  }

  async function handleControl(action) {
    if (action === "start" && !authenticated) {
      alert("Please authenticate your API keys before starting the bot.");
      return;
    }

    try {
      const data = await fetchJson(`/${action}`, { method: "POST" });
      if (data.status === "started") setStatus("Running");
      else if (data.status === "stopped") setStatus("Stopped");
      else if (data.status === "already running") setStatus("Running");
      else if (data.status === "error") {
        alert(data.message || "Error starting bot. Check credentials.");
        setStatus("Stopped");
      }
    } catch (err) {
      console.error("Control error:", err);
      setStatus("Error");
    }
  }

  async function fetchStatus() {
    try {
      const data = await fetchJson("/status");
      if (data.status) setStatus(data.status);
    } catch {
      setStatus("Unknown");
    }
  }

  async function fetchAccount() {
    try {
      const data = await fetchJson("/account");
      if (data && data.cash !== undefined) setAccount(data);
      else setAccount({ cash: null, invested: null, buying_power: null, equity: null });
    } catch {
      setAccount({ cash: null, invested: null, buying_power: null, equity: null });
    }
  }

  async function fetchPortfolio() {
    try {
      const data = await fetchJson("/positions");
      if (Array.isArray(data.positions)) setPortfolio(data.positions);
      else setPortfolio([]);
    } catch {
      setPortfolio([]);
    }
  }

  async function fetchOrders() {
    try {
      const data = await fetchJson("/orders");
      if (Array.isArray(data.orders)) setOrders(data.orders);
      else setOrders([]);
    } catch {
      setOrders([]);
    }
  }

  async function fetchTrades() {
    try {
      const data = await fetchJson("/trade_history");
      if (Array.isArray(data.trades)) setTrades(data.trades);
      else setTrades([]);
    } catch {
      setTrades([]);
    }
  }

  useEffect(() => {
    async function fetchLogs() {
      try {
        const json = await fetchJson("/logs");
        if (json.logs) setLogs(json.logs.join("\n"));
        else setLogs("No recent activity.");
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        setLogs("⚠️ Could not load log file.");
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchSmsStatus();
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchSmsStatus();
    }
  }, [authenticated]);

  useEffect(() => {
    if (logsBoxRef.current) {
      logsBoxRef.current.scrollTop = logsBoxRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    fetchDiscovered();
    fetchPortfolio();
    fetchStatus();
    fetchProgress();
    const updateResponsiveState = () => {
      const width = window.innerWidth;
      setCardsToShow(computeCardsToShow(width));
      setIsMobile(width <= 768);
      if (titleRef.current) {
        setTitleWidth(titleRef.current.getBoundingClientRect().width);
      }
    };
    updateResponsiveState();
    window.addEventListener("resize", updateResponsiveState);

    const statusInterval = setInterval(() => {
      fetchStatus();
      fetchProgress();
    }, 5000);

    return () => {
      clearInterval(statusInterval);
      window.removeEventListener("resize", updateResponsiveState);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      closeNav();
    }
  }, [isMobile]);

  useEffect(() => {
    if (titleRef.current) {
      setTitleWidth(titleRef.current.getBoundingClientRect().width);
    }
  }, [isMobile]);

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        closeNav();
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  useEffect(() => {
    setMeta((prev) => ({
      ...prev,
      displayed: Math.min(cardsToShow, prev.after_filters || 0),
    }));
  }, [cardsToShow]);

  useEffect(() => {
    if (!authenticated) return;
    fetchPortfolio();
    fetchOrders();
    fetchTrades();
    fetchAccount();
    const id = setInterval(fetchPortfolio, 10000);
    const id2 = setInterval(fetchOrders, 12000);
    const id4 = setInterval(fetchTrades, 25000);
    const id3 = setInterval(fetchAccount, 20000);
    return () => {
      clearInterval(id);
      clearInterval(id2);
      clearInterval(id3);
      clearInterval(id4);
    };
  }, [authenticated]);

  const calcGainLoss = (p) => ((p.currentPrice - p.avgPrice) * p.qty).toFixed(2);
  const calcTradePnl = (t) => {
    if (
      t.soldPrice === null ||
      t.soldPrice === undefined ||
      t.avgPrice === null ||
      t.avgPrice === undefined ||
      t.qty === null ||
      t.qty === undefined
    ) {
      return null;
    }
    const sold = Number(t.soldPrice);
    const avg = Number(t.avgPrice);
    const qty = Number(t.qty);
    if ([sold, avg, qty].some((v) => Number.isNaN(v))) return null;
    return ((sold - avg) * qty).toFixed(2);
  };
  const fmt1 = (v, suffix = "") => {
    if (v === null || v === undefined || Number.isNaN(Number(v)))
      return "N/A" + suffix;
    return Number(v).toFixed(1) + suffix;
  };
  const fmtMoney = (v) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? "N/A"
      : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const numOr = (v, fallback) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? fallback
      : Number(v);

  const navItems = [
    { label: "API Auth", href: "#auth-section" },
    { label: "Bot Status", href: "#status-section" },
    { label: "Live Feed", href: "#live-feed-section" },
    { label: "Discovery", href: "#discovery-section" },
    { label: "Portfolio", href: "#portfolio-section" },
  ];

  const toggleNav = () => setNavOpen((prev) => !prev);
  const closeNav = () => setNavOpen(false);
  const openNavDesktop = () => {
    if (!isMobile) setNavOpen(true);
  };
  const closeNavDesktop = () => {
    if (!isMobile) setNavOpen(false);
  };

  const sharedCardWidth = isMobile ? "95%" : "50%";
  const sharedCardMargin = isMobile ? "0 auto 24px" : "40px auto 80px";
  // Shared desktop sizing for the status and live feed cards to keep heights aligned
  const desktopCardHeight = "418px";
  const desktopCardBodyHeight = "326px";
  const desktopHeaderHeight = "92px";
  const sharedCardShell = {
    backgroundColor: "#FCFBF4",
    border: "4px solid #462323",
    borderRadius: isMobile ? "18px" : "10px",
    padding: 0,
    width: sharedCardWidth,
    textAlign: "center",
    color: "#462323",
    boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
    boxSizing: "border-box",
    height: isMobile ? "auto" : desktopCardHeight,
    minHeight: isMobile ? "auto" : desktopCardHeight,
    maxHeight: isMobile ? "none" : desktopCardHeight,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const styles = {
    page: {
      backgroundColor: "#483c3bd5",
      backgroundImage: "url('/circuit_bg4.png')",
      backgroundRepeat: "repeat",
      backgroundSize: "contain",
      color: "white",
      fontFamily: "Arial, sans-serif",
      minHeight: "100vh",
      overflowX: "hidden",
      overflowY: "auto",
      paddingTop: "0px",
      margin: 0,
      paddingBottom: "100px",
    },
    headerBox: {
      backgroundColor: "#462323",
      border: "0",
      borderBottom: "5px solid #FCFBF4",
      borderRadius: "0px",
      width: "100%",
      height: isMobile ? "64px" : "58px",
      margin: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: isMobile ? "6px 14px" : "2px 10px",
      position: "sticky",
      top: 0,
      boxShadow: "0 6px 12px rgba(0,0,0,0.25)",
      gap: "2px",
      zIndex: 40,
    },
    headerRow: {
      position: "relative",
      display: "grid",
      gridTemplateColumns: "1fr",
      alignItems: "center",
      justifyItems: "center",
      width: "100%",
      maxWidth: "1080px",
      padding: isMobile ? "0 18px" : "0",
    },
    titleMenu: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: isMobile ? "100%" : "auto",
    },
    title: {
      fontSize: isMobile ? "26px" : "32px",
      fontWeight: "900",
      letterSpacing: "1px",
      color: "#FCFBF4",
      textAlign: "center",
      margin: 0,
      cursor: "pointer",
    },
    navLinksInline: {
      display: "none",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "center",
      gap: "0",
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      top: "calc(100% + 10px)",
      width: titleWidth ? `${titleWidth}px` : "160px",
      minWidth: titleWidth ? `${titleWidth}px` : "160px",
      maxWidth: titleWidth ? `${titleWidth}px` : "160px",
      backgroundColor: "#FCFBF4",
      border: "2px solid #462323",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
      pointerEvents: "auto",
      zIndex: 45,
    },
    navLinkInline: {
      color: "#462323",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "700",
      padding: "12px 14px",
      borderBottom: "1px solid #462323",
      backgroundColor: "#FCFBF4",
      textAlign: "center",
    },
    navBar: {
      position: "static",
      width: "100%",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "transparent",
      padding: "0",
      border: "0",
      borderBottom: "0",
      boxShadow: "none",
      margin: "0",
    },
    authWrapper: {
      backgroundColor: "transparent",
      border: "none",
      borderRadius: "0px",
      width: isMobile ? "88%" : "75%",
      maxWidth: isMobile ? "320px" : "900px",
      margin: isMobile ? "30px auto 50px" : "50px auto 70px",
      padding: isMobile ? "0 0 24px 0" : "20px 0 40px 0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    authBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      width: isMobile ? "78%" : "60%",
      maxWidth: isMobile ? "360px" : "750px",
      margin: isMobile ? "12px auto" : "30px auto",
      textAlign: "center",
      padding: "0",
      borderRadius: "18px",
      color: "black",
      overflow: "hidden",
    },
    authContent: {
      padding: isMobile ? "18px 24px 16px" : "50px 50px 30px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    authInput: {
      width: isMobile ? "85%" : "80%",
      padding: isMobile ? "9px" : "12px",
      margin: isMobile ? "6px auto" : "8px 0",
      border: "2px solid #462323",
      borderRadius: "6px",
      fontSize: isMobile ? "14px" : "16px",
    },
    authButton: {
      padding: isMobile ? "8px 18px" : "10px 22px",
      marginTop: isMobile ? "18px" : "16px",
      marginRight: "auto",
      marginLeft: "auto",
      border: "3px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      fontWeight: "700",
      fontSize: isMobile ? "14px" : "16px",
      cursor: "pointer",
      width: isMobile ? "60%" : "auto",
      display: "block",
    },
    statusBox: {
      ...sharedCardShell,
      margin: sharedCardMargin,
    },
    statusContent: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: isMobile ? "12px 20px 18px" : "24px 30px 30px",
      width: "100%",
      boxSizing: "border-box",
      gap: isMobile ? "10px" : "14px",
    },
    statusButtonRow: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: isMobile ? "10px" : "24px",
      flexWrap: "nowrap",
      width: "100%",
    },
    sectionHeaderDiv: {
      backgroundColor: "#462323",
      border: "5px solid #FCFBF4",
      borderRadius: "10px",
      width: "60%",
      margin: "0 auto 20px",
      textAlign: "center",
      padding: "10px 0",
      color: "#FCFBF4",
      fontWeight: "bold",
      fontSize: "26px",
    },
    table: {
      width: isMobile ? "100%" : "80%",
      margin: "0 auto",
      borderCollapse: "collapse",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      border: "4px solid #462323",
      borderRadius: "10px",
      boxSizing: "border-box",
    },
    th: {
      border: "2px solid #462323",
      padding: isMobile ? "4px" : "10px",
      backgroundColor: "#462323",
      color: "#FCFBF4",
      fontSize: isMobile ? "12px" : "18px",
    },
    td: {
      border: "2px solid #462323",
      padding: isMobile ? "4px" : "8px",
      fontSize: isMobile ? "12px" : "16px",
    },
    gainLoss: {
      border: "2px solid #462323",
      width: isMobile ? "80px" : "100px",
      textAlign: "center",
    },
    discoveryWrapper: {
      backgroundColor: "transparent",
      border: "none",
      borderRadius: "0px",
      width: "100%",
      maxWidth: isMobile ? "420px" : "100%",
      margin: isMobile ? "-12px auto 18px" : "0 auto 20px",
      padding: isMobile ? "10px 4% 20px 4%" : "30px 0 30px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    portfolioWrapper: {
      backgroundColor: "transparent",
      border: "0",
      borderRadius: "0px",
      width: isMobile ? "100vw" : "100%",
      margin: isMobile ? "0 auto 40px calc(50% - 50vw)" : "0 auto 40px",
      padding: isMobile ? "0 0 20px" : "60px 0 30px",
      boxSizing: "border-box",
    },
    discoveryGrid: isMobile
      ? {
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "10px",
          width: "100%",
          maxWidth: "360px",
          margin: "0 auto",
          boxSizing: "border-box",
          padding: "0 8px",
          justifyItems: "center",
          alignItems: "stretch",
          gridAutoRows: "1fr",
        }
      : {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          justifyItems: "center",
          gap: "2rem",
          width: "100%",
          maxWidth: "1200px",
          margin: "0 auto",
          boxSizing: "border-box",
          padding: "0 24px",
        },
    stockCard: {
      border: "4px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      width: isMobile ? "100%" : "220px",
      maxWidth: "240px",
      textAlign: "center",
      textDecoration: "none",
      padding: isMobile ? "10px 6px" : "12px 10px",
      margin: isMobile ? "0" : "10px",
      boxSizing: "border-box",
    },
    stockTickerBox: {
      backgroundColor: "#462323",
      color: "#FCFBF4",
      borderRadius: "6px",
      padding: isMobile ? "4px 0" : "5px 0",
      marginBottom: isMobile ? "0" : "8px",
      fontWeight: "bold",
      fontSize: isMobile ? "15px" : "22px",
      width: "100%",
      textAlign: "center",
    },
    stockPrice: {
      fontSize: isMobile ? "15px" : "18px",
      fontWeight: "bold",
      marginTop: isMobile ? "6px" : "0",
      marginBottom: isMobile ? "3px" : "8px",
      width: "100%",
      textAlign: "center",
    },
    metricTable: {
      width: isMobile ? "88%" : "100%",
      borderCollapse: "collapse",
      marginTop: isMobile ? "2px" : "8px",
      marginLeft: "auto",
      marginRight: "auto",
      tableLayout: "fixed",
      alignSelf: "center",
    },
    metricName: {
      textAlign: "left",
      fontWeight: "700",
      color: "#462323",
      padding: isMobile ? "1px 2px 0" : "4px",
      borderBottom: "1px solid #462323",
      fontSize: isMobile ? "10.5px" : undefined,
      lineHeight: isMobile ? "1.15" : undefined,
      width: "56%",
      verticalAlign: "middle",
      whiteSpace: "nowrap",
    },
    metricValue: {
      textAlign: "right",
      padding: isMobile ? "1px 2px 0" : "4px",
      borderBottom: "1px solid #462323",
      fontSize: isMobile ? "9.5px" : undefined,
      lineHeight: isMobile ? "1.1" : undefined,
      whiteSpace: "nowrap",
      width: "44%",
      verticalAlign: "middle",
    },
    metricValueContent: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: isMobile ? "1px" : "4px",
      width: "100%",
    },
    confidenceBadge: (color) => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      margin: isMobile ? "12px auto 0" : "12px auto 0",
      padding: isMobile ? "1px 4px" : "3px 7px",
      borderRadius: "6px",
      fontSize: isMobile ? "6.5px" : "12px",
      fontWeight: "bold",
      backgroundColor: color,
      color: "#FCFBF4",
      border: "1px solid #462323",
      textAlign: "center",
      width: "fit-content",
    }),
    stockCardInner: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      width: "100%",
      gap: isMobile ? "1px" : "4px",
    },
    strategyTag: () => ({
      display: "block",
      marginTop: isMobile ? "8px" : "10px",
      padding: isMobile ? "1px 4px" : "3px 6px",
      borderRadius: "6px",
      fontSize: isMobile ? "10px" : "13px",
      fontWeight: "700",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      border: "1px solid #FCFBF4",
      textAlign: "center",
    }),
    liveFeedBox: {
      backgroundColor: "#FCFBF4",
      border: "0",
      borderRadius: isMobile ? "0 0 18px 18px" : "0 0 10px 10px",
      width: "100%",
      margin: "0 auto",
      color: "#462323",
      padding: isMobile ? "18px 22px" : "16px 18px",
      boxSizing: "border-box",
      height: isMobile ? "auto" : desktopCardBodyHeight,
      maxHeight: isMobile ? "340px" : desktopCardBodyHeight,
      minHeight: isMobile ? "220px" : desktopCardBodyHeight,
      overflowY: "auto",
      fontFamily: "monospace",
      lineHeight: 1.4,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      boxShadow: "none",
      flex: 1,
    },
    tradeButton: {
      padding: isMobile ? "8px 18px" : "10px 24px",
      marginTop: isMobile ? "6px" : "10px",
      border: "3px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      fontWeight: "700",
      fontSize: isMobile ? "14px" : "16px",
      cursor: "pointer",
      marginRight: 0,
    },
  };

  const responsiveCss = `
    @media (max-width: 900px) {
      .status-live-row { flex-direction: column !important; gap: 32px !important; padding: 0 12px !important; }
      .status-card, .live-feed-card { width: 100% !important; margin: 0 !important; }
      .live-feed-box { width: 100% !important; max-height: 320px !important; }
      .discovery-wrapper, .portfolio-wrapper { width: 100% !important; padding: 30px 12px !important; }
      .discovery-grid { width: 100% !important; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) !important; gap: 1rem !important; }
      .table-wrap { width: 100% !important; }
      .table-wrap table { min-width: auto !important; }
      .section-header { width: 100% !important; font-size: 24px !important; }
      .portfolio-wrapper .table-wrap { padding: 0 !important; margin: 0 !important; }
      .portfolio-wrapper table { width: 100% !important; }
    }

    @media (max-width: 540px) {
      .title { font-size: 26px !important; }
      .section-header { font-size: 20px !important; }
      .discovery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 10px !important; }
      .live-feed-box { max-height: 260px !important; }
    }
  `;

  const statusLiveRowStyle = isMobile
    ? {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "28px",
        padding: "0 12px",
        marginTop: "50px",
        marginBottom: "30px",
        width: "100%",
      }
    : {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: "80px",
        padding: "0 24px",
        marginTop: "85px",
        marginBottom: "40px",
        maxWidth: "1100px",
        width: "80%",
        marginLeft: "auto",
        marginRight: "auto",
      };

  const controlButtonStyle = {
    ...styles.authButton,
    width: isMobile ? "44%" : "auto",
    marginRight: isMobile ? "0" : "32px",
    marginLeft: "0",
    display: "inline-block",
  };

  const authHeaderBarStyle = isMobile
    ? {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        marginTop: "-4px",
        padding: "26px 22px",
        borderRadius: "18px 18px 0 0",
        fontWeight: "900",
        fontSize: "28px",
        borderBottom: "4px solid #FCFBF4",
        boxSizing: "border-box",
        minHeight: "96px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        width: "100%",
      }
    : {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        marginTop: "-4px",
        padding: "16px 18px",
        borderRadius: "10px 10px 0 0",
        fontWeight: "900",
        fontSize: "32px",
        borderBottom: "4px solid #FCFBF4",
        boxSizing: "border-box",
        minHeight: "78px",
        width: "100%",
      };

  const statusHeaderBarStyle = isMobile
    ? {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        marginTop: "-4px",
        padding: "22px 22px",
        borderRadius: "18px 18px 0 0",
        fontWeight: "900",
        fontSize: "30px",
        borderBottom: "4px solid #FCFBF4",
        boxSizing: "border-box",
        width: "100%",
        textAlign: "center",
        minHeight: "88px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }
    : {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        marginTop: "-4px",
        padding: "16px 18px",
        borderRadius: "10px 10px 0 0",
        fontWeight: "900",
        fontSize: "32px",
        borderBottom: "4px solid #FCFBF4",
        boxSizing: "border-box",
        width: "100%",
        textAlign: "center",
        minHeight: desktopHeaderHeight,
        height: desktopHeaderHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      };

  const textAlertLabel = smsStatus.enabled
    ? `Text Alerts: ON (${smsStatus.phone || ""})`
    : "Text Alerts: OFF";

  const statusBodyStyle = {
    backgroundColor: "#FCFBF4",
    borderRadius: isMobile ? "0 0 18px 18px" : "0 0 10px 10px",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    boxSizing: "border-box",
    height: isMobile ? "auto" : desktopCardBodyHeight,
    minHeight: isMobile ? "auto" : desktopCardBodyHeight,
    maxHeight: isMobile ? "none" : desktopCardBodyHeight,
  };

  const liveFeedCardStyle = {
    width: sharedCardWidth,
    display: "flex",
    flexDirection: "column",
    justifyContent: "stretch",
    alignItems: "center",
    margin: sharedCardMargin,
  };

  const liveFeedWidth = "100%";

  const liveFeedShellStyle = {
    ...sharedCardShell,
    width: liveFeedWidth,
    margin: "0 auto",
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
  };

  const liveFeedHeaderStyle = isMobile
    ? {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        padding: "24px 18px",
        borderBottom: "4px solid #FCFBF4",
        borderRadius: "18px 18px 0 0",
        textAlign: "center",
        fontWeight: "900",
        fontSize: "32px",
        marginTop: "-4px",
        minHeight: "92px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }
    : {
        backgroundColor: "#462323",
        color: "#FCFBF4",
        padding: "16px 14px",
        borderBottom: "4px solid #FCFBF4",
        borderRadius: "10px 10px 0 0",
        textAlign: "center",
        fontWeight: "900",
        fontSize: "30px",
        marginTop: "-4px",
        boxSizing: "border-box",
        minHeight: desktopHeaderHeight,
        height: desktopHeaderHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      };

  return (
    <div style={styles.page}>
      <style>{responsiveCss}</style>
      <div style={styles.navBar}>
        <div
          style={{
            ...styles.headerBox,
            margin: "0 auto",
          }}
        >
          <div style={styles.headerRow}>
            <div
              style={{
                ...styles.titleMenu,
              }}
              onMouseEnter={openNavDesktop}
              onMouseLeave={closeNavDesktop}
              onClick={() => {
                if (isMobile) toggleNav();
              }}
            >
              <h1 style={styles.title} className="title" ref={titleRef}>
                CAIMEO
              </h1>
              <div
                className="nav-links-inline"
                style={{
                  ...styles.navLinksInline,
                  display: navOpen ? "flex" : "none",
                }}
                onMouseEnter={openNavDesktop}
                onMouseLeave={closeNavDesktop}
              >
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    style={styles.navLinkInline}
                    onClick={closeNav}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                right: isMobile ? "12px" : "18px",
                top: isMobile ? "10px" : "12px",
                color: "#FCFBF4",
                fontWeight: "700",
                fontSize: isMobile ? "10px" : "14px",
                textAlign: "right",
              }}
            >
              {textAlertLabel}
            </div>
          </div>
        </div>
      </div>
      {navOpen && isMobile ? <div className="nav-overlay" onClick={closeNav} /> : null}

      {showSmsPrompt ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.35)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px",
          }}
        >
          <div
            style={{
              backgroundColor: "#FCFBF4",
              border: "4px solid #462323",
              borderRadius: isMobile ? "16px" : "10px",
              width: isMobile ? "92%" : "420px",
              maxWidth: "520px",
              boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
              color: "#462323",
              padding: isMobile ? "18px 16px 20px" : "20px 24px 28px",
              textAlign: "center",
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: isMobile ? "22px" : "24px", fontWeight: "900" }}>
              Sign up for text updates
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: isMobile ? "13px" : "14px" }}>
              Enter your phone number to get CAIMEO trade and order summaries by text.
            </p>
            <form onSubmit={submitSmsSignup} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <input
                type="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                placeholder="Phone number"
                required
                style={{
                  ...styles.authInput,
                  width: "92%",
                  maxWidth: "360px",
                  margin: "0 auto",
                  textAlign: "center",
                }}
              />
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <button type="submit" style={{ ...styles.authButton, margin: 0 }}>
                  Submit
                </button>
                <button
                  type="button"
                  style={{ ...styles.authButton, margin: 0 }}
                  onClick={() => setShowSmsPrompt(false)}
                >
                  Not now
                </button>
              </div>
            </form>
            {smsNotice ? (
              <p style={{ marginTop: "12px", fontWeight: "700" }}>{smsNotice}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div id="auth-section" style={styles.authWrapper} className="auth-wrapper">
        <div style={styles.authBox} className="auth-box">
          <div style={authHeaderBarStyle} className="section-header">
            <h2 style={{ margin: 0, fontSize: isMobile ? "30px" : "38px", lineHeight: 1.1 }}>
              API Auth
            </h2>
          </div>
          <div
            style={{
              backgroundColor: "#FCFBF4",
              borderRadius: isMobile ? "0 0 18px 18px" : "0 0 8px 8px",
            }}
          >
            <div style={{ ...styles.authContent, paddingTop: "24px" }}>
              <form onSubmit={submitKeys}>
                <input
                  style={styles.authInput}
                  className="auth-input"
                  type="text"
                  placeholder="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <br />
                <input
                  style={styles.authInput}
                  className="auth-input"
                  type="password"
                  placeholder="API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                />
                <br />
                <button style={styles.authButton} type="submit">
                  Submit
                </button>
              </form>
              <p>{msg}</p>
            </div>
          </div>
        </div>

        <div className="status-live-row" style={statusLiveRowStyle}>
          <div id="status-section" style={styles.statusBox} className="status-card">
            <div style={statusHeaderBarStyle}>
              <h3 style={{ margin: 0, fontSize: isMobile ? "30px" : "36px" }}>Bot Status</h3>
            </div>
            <div style={statusBodyStyle}>
              <div style={{ ...styles.statusContent, paddingTop: isMobile ? "12px" : "20px" }}>
                <div
                  style={{
                    display: "inline-block",
                    marginTop: isMobile ? "10px" : "38px",
                    padding: "13px 26px",
                    borderRadius: "999px",
                    backgroundColor: status === "Running" ? "#2ecc71" : "#e74c3c",
                    color: "#FCFBF4",
                    fontWeight: "900",
                    fontSize: isMobile ? "22px" : "18px",
                    border: "2px solid #FCFBF4",
                  }}
                >
                  {status}
                </div>
                <div style={styles.statusButtonRow}>
                  <button
                    style={{
                      ...controlButtonStyle,
                      opacity: authenticated ? 1 : 0.5,
                      cursor: authenticated ? "pointer" : "not-allowed",
                    }}
                    disabled={!authenticated}
                    onClick={() => handleControl("start")}
                  >
                    Start
                  </button>
                  <button
                    style={{ ...controlButtonStyle, marginRight: 0 }}
                    onClick={() => handleControl("stop")}
                  >
                    Stop
                  </button>
                </div>
                <p style={{ fontSize: "18px", marginTop: isMobile ? "14px" : "52px" }}>
                  Authenticated:{" "}
                  <span style={{ color: authenticated ? "green" : "red" }}>
                    {authenticated ? "✅" : "❌"}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div style={liveFeedCardStyle} className="live-feed-card" id="live-feed-section">
            <div style={liveFeedShellStyle}>
              <div style={liveFeedHeaderStyle}>
                <h2 style={{ margin: 0, fontSize: isMobile ? "32px" : "30px", lineHeight: "1.1" }}>Live Feed</h2>
              </div>
              <div className="live-feed-box" style={styles.liveFeedBox} ref={logsBoxRef}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{logs}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.discoveryWrapper} id="discovery-section" className="discovery-wrapper">
        <div
          style={{
            ...styles.sectionHeaderDiv,
            width: isMobile ? "100%" : "85%",
            backgroundColor: "transparent",
            border: "none",
            color: "#FCFBF4",
            margin: "0 auto",
          }}
          className="section-header"
        >
          <div
            style={{
              backgroundColor: "#462323",
              color: "#FCFBF4",
              padding: "12px 0",
              fontSize: isMobile ? "40px" : "58px",
              fontWeight: "800",
              border: "4px solid #462323",
              borderRadius: "10px 10px 0 0",
              width: isMobile ? "96%" : "95%",
              margin: "0 auto",
            }}
          >
            Discovery
          </div>

          <div
            style={{
              backgroundColor: "#FCFBF4",
              border: "4px solid #462323",
              borderRadius: "0 0 10px 10px",
              width: isMobile ? "92%" : "90%",
              margin: "0 auto 10px",
              padding: isMobile ? "6px 0" : "10px 0",
              textAlign: "center",
              color: "#462323",
              fontWeight: "bold",
              fontSize: isMobile ? "14px" : "18px",
              boxSizing: "border-box",
            }}
          >
            <p style={{ margin: "20px 0 0 0" }}>
              <strong>{progress.status}</strong> — {progress.percent.toFixed(1)}% ({progress.eta} remaining)
            </p>
              <div
                style={{
                  backgroundColor: "#837777ff",
                  width: isMobile ? "82%" : "86%",
                  height: isMobile ? "12px" : "18px",
                  borderRadius: "8px",
                  border: "2px solid #462323",
                  margin: "10px auto",
                  overflow: "hidden",
                }}
              >
              <div
                style={{
                  width: `${progress.percent}%`,
                  height: "100%",
                  backgroundColor: progress.percent >= 100 ? "#05630bff" : "#7dc242",
                  transition: "width 0.5s ease-in-out",
                }}
              ></div>
            </div>
          </div>
        </div>

        <div className="discovery-grid" style={isMobile ? undefined : styles.discoveryGrid}>
          {discovered.length > 0 ? (
            discovered.slice(0, Math.min(cardsToShow, discovered.length)).map((item, i) => {
              const symbol = item.symbol || item;
              const url = `https://finance.yahoo.com/quote/${symbol}`;
              const eps = numOr(item.eps, null);
              const pe = numOr(item.pe, null);
              const revenueChange = numOr(item.revenue, null);
              const price = numOr(item.last_price, null);
              const prevQuarterPrice = numOr(
                item.prev_quarter_price,
                price / (1 + (item.growth ?? 0) / 100)
              );
              const growth =
                prevQuarterPrice && prevQuarterPrice > 0
                  ? ((price - prevQuarterPrice) / prevQuarterPrice) * 100
                  : null;
              const roundedGrowth = growth !== null ? Math.round(growth) : null;

              const revenueDisplay =
                revenueChange !== null
                  ? isMobile
                    ? `${Math.round(Math.abs(revenueChange))}%`
                    : `${Math.abs(revenueChange).toFixed(1)}%`
                  : "N/A";

              const confLetter = (item.confidence || "F").toUpperCase();
              const colorMap = { A: "#3cb043", B: "#7dc242", C: "#f0c93d", D: "#f28f3b", F: "#d94f4f" };
              const grade = confLetter;
              const color = colorMap[confLetter] || "#d94f4f";
              const inferredStrategy = () => {
                if (item.strategy) return item.strategy;
                if (item.rebound !== undefined || item.drop_5d !== undefined) return "5 Day Strategy";
                if (item.gain_3d !== undefined) return "3 Day Strategy";
                return null;
              };
              const strategyLabel = inferredStrategy() || "N/A";

              return (
                <a
                  key={`${symbol}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={isMobile ? undefined : styles.stockCard}
                  className="stock-card"
                >
                  <div style={styles.stockCardInner}>
                    <div style={styles.stockTickerBox} className="stock-card__ticker">
                      {symbol}
                    </div>
                    <p style={styles.stockPrice} className="stock-card__price">
                      {price === null ? "N/A" : `$${price.toFixed(2)}`}
                    </p>
                    <table style={styles.metricTable}>
                      <colgroup>
                        <col style={{ width: "56%" }} />
                        <col style={{ width: "44%" }} />
                      </colgroup>
                      <tbody>
                        <tr>
                          <td style={styles.metricName}>EPS</td>
                          <td
                            style={{
                              ...styles.metricValue,
                              color: eps > 0 ? "green" : eps < 0 ? "red" : "#462323",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={styles.metricValueContent}>
                              <span>{eps !== null ? `${Math.abs(eps).toFixed(1)}%` : "N/A"}</span>
                              <span>{eps > 0 ? "▲" : eps < 0 ? "▼" : ""}</span>
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td style={styles.metricName}>Revenue</td>
                          <td
                            style={{
                              ...styles.metricValue,
                              color: revenueChange > 0 ? "green" : revenueChange < 0 ? "red" : "#462323",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={styles.metricValueContent}>
                              <span>{revenueDisplay}</span>
                              <span>{revenueChange > 0 ? "▲" : revenueChange < 0 ? "▼" : ""}</span>
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td style={styles.metricName}>P/E</td>
                          <td
                            style={{
                              ...styles.metricValue,
                              color: pe > 0 ? "green" : pe < 0 ? "red" : "#462323",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={styles.metricValueContent}>
                              <span>{pe !== null ? `${Math.abs(pe).toFixed(1)}%` : "N/A"}</span>
                              <span>{pe > 0 ? "▲" : pe < 0 ? "▼" : ""}</span>
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td style={styles.metricName}>Growth</td>
                          <td
                            style={{
                              ...styles.metricValue,
                              color: growth > 0 ? "green" : growth < 0 ? "red" : "#462323",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={styles.metricValueContent}>
                              <span>{roundedGrowth !== null ? `${Math.abs(roundedGrowth)}%` : "N/A"}</span>
                              <span>{growth > 0 ? "▲" : growth < 0 ? "▼" : ""}</span>
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={styles.confidenceBadge(color)}>Confidence: {grade}</div>
                    <div style={styles.strategyTag(color)}>{strategyLabel}</div>
                  </div>
                </a>
              );
            })
          ) : (
            <div
              className="discovery-placeholder"
              style={{ width: "100%", display: "flex", justifyContent: "center", gridColumn: "1 / -1" }}
            >
              <a
                href="https://finance.yahoo.com/quote/CAIMEO"
                target="_blank"
                rel="noopener noreferrer"
                style={isMobile ? undefined : styles.stockCard}
                className="stock-card"
              >
                <div style={styles.stockCardInner}>
                  <div style={styles.stockTickerBox} className="stock-card__ticker">
                    CAIMEO
                  </div>
                  <p style={styles.stockPrice} className="stock-card__price">
                    $9.00
                  </p>
                  <table style={styles.metricTable}>
                    <colgroup>
                      <col style={{ width: "56%" }} />
                      <col style={{ width: "44%" }} />
                    </colgroup>
                    <tbody>
                      <tr>
                        <td style={styles.metricName}>EPS</td>
                        <td style={{ ...styles.metricValue, color: "green" }}>
                          <span style={styles.metricValueContent}>
                            <span>2.0</span>
                            <span style={{ color: "green" }}>▲</span>
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style={styles.metricName}>Revenue</td>
                        <td style={{ ...styles.metricValue, color: "green" }}>
                          <span style={styles.metricValueContent}>
                            <span>15%</span>
                            <span style={{ color: "green" }}>▲</span>
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style={styles.metricName}>P/E</td>
                        <td style={{ ...styles.metricValue, color: "green" }}>
                          <span style={styles.metricValueContent}>
                            <span>18.0</span>
                            <span style={{ color: "green" }}>▲</span>
                          </span>
                        </td>
                      </tr>
                        <tr>
                          <td style={styles.metricName}>Growth</td>
                          <td style={styles.metricValue}>
                          <span style={styles.metricValueContent}>
                            <span>12%</span>
                            <span></span>
                          </span>
                        </td>
                        </tr>
                    </tbody>
                  </table>
                  <div style={styles.confidenceBadge("#3cb043")}>Confidence: A</div>
                  <div style={styles.strategyTag("#3cb043")}>3-Day Momentum</div>
                </div>
              </a>
            </div>
          )}
        </div>
      </div>

      <div style={styles.portfolioWrapper} id="portfolio-section" className="portfolio-wrapper">
        <div className="table-wrap" style={{ width: "100%", margin: isMobile ? "0 12px" : "0 auto", padding: 0 }}>
          <table
            style={{
              ...styles.table,
              width: "100%",
              border: "0",
              marginLeft: 0,
              marginRight: 0,
              boxSizing: "border-box",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...styles.th, fontSize: isMobile ? "20px" : "32px" }} colSpan={5}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: isMobile ? "28px" : "54px" }}>Portfolio</span>
                    <div
                      style={{
                        width: "100%",
                        backgroundColor: "#462323",
                        color: "#FCFBF4",
                        border: "2px solid #462323",
                        padding: isMobile ? "4px 6px" : "6px 8px",
                        fontSize: isMobile ? "16px" : "22px",
                        fontWeight: "600",
                        borderRadius: "0px",
                      }}
                    >
                      {authenticated && account?.equity !== null
                        ? fmtMoney(account.equity)
                        : "Authenticate to view equity"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: isMobile ? "10px" : "14px",
                        flexWrap: "nowrap",
                        marginTop: isMobile ? "4px" : "8px",
                      }}
                    >
                      <button style={styles.tradeButton} onClick={() => handleControl("start")}>
                        Start Live Trading
                      </button>
                      <button style={styles.tradeButton} onClick={() => handleControl("stop")}>
                        Stop Live Trading
                      </button>
                    </div>
                  </div>
                </th>
              </tr>
              <tr>
                <th style={styles.th}>Symbol</th>
                <th style={styles.th}>Qty</th>
                <th style={styles.th}>Avg Price</th>
                <th style={styles.th}>Current Price</th>
                <th style={styles.th}>Gain/Loss</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.length > 0 ? (
                portfolio.map((p, i) => {
                  const gainLoss = calcGainLoss(p);
                  const isGain = gainLoss >= 0;
                  return (
                    <tr key={i}>
                      <td style={styles.td}>{p.symbol}</td>
                      <td style={styles.td}>{p.qty}</td>
                      <td style={styles.td}>${Number(p.avgPrice).toFixed(2)}</td>
                      <td style={styles.td}>${Number(p.currentPrice).toFixed(2)}</td>
                      <td
                        style={{
                          ...styles.gainLoss,
                          color: isGain ? "green" : "red",
                        }}
                      >
                        ${gainLoss}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td style={styles.td}>CAIMEO</td>
                  <td style={styles.td}>3</td>
                  <td style={styles.td}>$6.00</td>
                  <td style={styles.td}>$9.00</td>
                  <td style={{ ...styles.gainLoss, color: "green" }}>$9.00</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-wrap" style={{ width: "100%", margin: isMobile ? "40px 12px 0" : "40px auto 0", padding: 0 }}>
          <table
            style={{
              ...styles.table,
              marginTop: "64px",
              width: isMobile ? "100%" : "70%",
              transform: isMobile ? "none" : "scale(0.9)",
              transformOrigin: "top center",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...styles.th, fontSize: "32px" }} colSpan={6}>
                  Open Orders
                </th>
              </tr>
              <tr>
                <th style={styles.th}>Symbol</th>
                <th style={styles.th}>Side</th>
                <th style={styles.th}>Qty</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Limit/Stop</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.length > 0 ? (
                orders.map((o, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{o.symbol}</td>
                    <td style={styles.td}>{o.side}</td>
                    <td style={styles.td}>{o.qty}</td>
                    <td style={styles.td}>{o.type}</td>
                    <td style={styles.td}>
                      {o.limit_price
                        ? `$${Number(o.limit_price).toFixed(2)}`
                        : o.stop_price
                        ? `$${Number(o.stop_price).toFixed(2)}`
                        : "—"}
                    </td>
                    <td style={styles.td}>{o.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>No open orders</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-wrap" style={{ width: "100%", margin: isMobile ? "40px 12px 0" : "40px auto 0", padding: 0 }}>
          <table
            style={{
              ...styles.table,
              marginTop: "64px",
              width: isMobile ? "100%" : "70%",
              transform: isMobile ? "none" : "scale(0.9)",
              transformOrigin: "top center",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...styles.th, fontSize: "32px" }} colSpan={5}>
                  Trade History
                </th>
              </tr>
              <tr>
                <th style={styles.th}>Symbol</th>
                <th style={styles.th}>Qty</th>
                <th style={styles.th}>Avg Price</th>
                <th style={styles.th}>Sold Price</th>
                <th style={styles.th}>Gain/Loss</th>
              </tr>
            </thead>
            <tbody>
              {authenticated ? (
                trades.length > 0 ? (
                  trades.map((t, i) => {
                    const gainLoss = calcTradePnl(t);
                    const isGain = gainLoss !== null && gainLoss >= 0;
                    return (
                      <tr key={i}>
                        <td style={styles.td}>{t.symbol}</td>
                        <td style={styles.td}>{t.qty}</td>
                        <td style={styles.td}>
                          {t.avgPrice !== null && t.avgPrice !== undefined
                            ? `$${Number(t.avgPrice).toFixed(2)}`
                            : "—"}
                        </td>
                        <td style={styles.td}>
                          {t.soldPrice !== null && t.soldPrice !== undefined
                            ? `$${Number(t.soldPrice).toFixed(2)}`
                             : "—"}
                        </td>
                        <td
                          style={{
                            ...styles.gainLoss,
                            color: gainLoss === null ? "#462323" : isGain ? "green" : "red",
                          }}
                        >
                          {gainLoss === null ? "—" : `$${gainLoss}`}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td style={styles.td} colSpan={5}>
                      No trades yet.
                    </td>
                  </tr>
                )
              ) : (
                <tr>
                  <td style={styles.td} colSpan={5}>
                    Authenticate to view trade history.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;
