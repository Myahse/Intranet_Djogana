import { StyleSheet } from "react-native";
import { s, vs, fs } from "@/responsive";

export const hStyles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: s(12),
    padding: s(14),
    marginBottom: vs(10),
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(8),
  },
  code: {
    fontSize: fs(18),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: s(3),
    color: "#333",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(10),
    paddingVertical: vs(4),
    borderRadius: s(20),
    gap: s(4),
  },
  statusText: {
    fontSize: fs(12),
    fontWeight: "600",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
  },
  dateText: {
    fontSize: fs(12),
    color: "#999",
  },
});

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: s(16) },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },

  /* Connection indicator */
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginBottom: vs(8),
  },
  connectionDot: {
    width: s(8),
    height: s(8),
    borderRadius: s(4),
  },
  connectionText: {
    fontSize: fs(12),
    color: "#999",
    fontWeight: "500",
  },

  /* Tab bar */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#e5e5e5",
    borderRadius: s(12),
    padding: s(3),
    marginBottom: vs(14),
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(10),
    borderRadius: s(10),
    gap: s(6),
  },
  tabActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: fs(14),
    fontWeight: "500",
    color: "#999",
  },
  tabTextActive: {
    color: "#0a0a0a",
    fontWeight: "600",
  },
  badge: {
    backgroundColor: "#dc2626",
    borderRadius: s(10),
    minWidth: s(20),
    height: s(20),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: s(5),
  },
  badgeText: {
    color: "#fff",
    fontSize: fs(11),
    fontWeight: "700",
  },

  hint: { fontSize: fs(14), color: "#666", marginBottom: vs(14) },
  pushHint: {
    fontSize: fs(13), color: "#b45309", marginBottom: vs(12),
    backgroundColor: "#fffbeb", padding: s(10), borderRadius: s(8),
  },
  errorBanner: {
    backgroundColor: "#fef2f2", padding: s(12), borderRadius: s(8),
    marginBottom: vs(16), borderWidth: 1, borderColor: "#fecaca",
  },
  errorText: { fontSize: fs(14), color: "#b91c1c" },

  list: { paddingBottom: vs(24) },
  emptyList: { flex: 1 },
  empty: { padding: s(32), alignItems: "center" },
  emptyText: { fontSize: fs(15), color: "#888", textAlign: "center" },

  /* ── Request card ── */
  card: {
    backgroundColor: "#fff",
    borderRadius: s(12),
    padding: s(16),
    marginBottom: vs(12),
    borderWidth: 1,
    borderColor: "#eee",
    overflow: "hidden",
  },
  /** Green glow overlay that fades out on new live cards */
  newGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(22, 163, 74, 0.08)",
    borderRadius: s(12),
    borderWidth: 2,
    borderColor: "rgba(22, 163, 74, 0.35)",
  },
  cardExpired: {
    opacity: 0.55,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(10),
  },
  code: {
    fontSize: fs(22),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: s(4),
    color: "#111",
  },
  codeExpired: {
    color: "#aaa",
  },

  /* Timer badge */
  timerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    paddingHorizontal: s(10),
    paddingVertical: vs(5),
    borderRadius: s(20),
    gap: s(4),
  },
  timerText: {
    fontSize: fs(13),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  /* Progress bar */
  progressTrack: {
    height: vs(4),
    backgroundColor: "#f0f0f0",
    borderRadius: s(2),
    marginBottom: vs(14),
    overflow: "hidden",
  },
  progressBar: {
    height: vs(4),
    borderRadius: s(2),
  },

  expiredLabel: {
    fontSize: fs(13),
    color: "#999",
    textAlign: "center",
    fontStyle: "italic",
  },

  /* Action buttons */
  actions: { flexDirection: "row", gap: s(10) },
  btn: { flex: 1, paddingVertical: vs(12), borderRadius: s(10), alignItems: "center" },
  btnApprove: { backgroundColor: "#0a0a0a" },
  btnDeny: { backgroundColor: "#f0f0f0" },
  btnText: { color: "#fff", fontSize: fs(15), fontWeight: "600" },
  btnTextDeny: { color: "#333", fontSize: fs(15), fontWeight: "600" },

  /* Security button */
  securityButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee",
    borderRadius: s(12), paddingVertical: vs(14), marginTop: vs(16), gap: s(8),
  },
  securityButtonText: { fontSize: fs(15), fontWeight: "600", color: "#0a0a0a" },

  logout: { marginTop: vs(12), paddingVertical: vs(12), alignItems: "center" },
  logoutText: { fontSize: fs(15), color: "#666" },

});
