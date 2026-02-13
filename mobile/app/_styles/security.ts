import { StyleSheet } from "react-native";
import { s, vs, fs } from "@/responsive";

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  scrollContent: { padding: s(16), paddingBottom: vs(40) },

  header: { alignItems: "center", paddingVertical: vs(24) },
  avatarContainer: {
    width: s(64), height: s(64), borderRadius: s(32),
    backgroundColor: "#0a0a0a",
    justifyContent: "center", alignItems: "center", marginBottom: vs(12),
  },
  userName: { fontSize: fs(18), fontWeight: "700", color: "#111", marginBottom: vs(4) },
  userRole: { fontSize: fs(14), color: "#888" },

  sectionTitle: {
    fontSize: fs(13), fontWeight: "600", color: "#999",
    textTransform: "uppercase", letterSpacing: s(0.5),
    marginBottom: vs(8), marginLeft: s(4),
  },

  menuCard: {
    backgroundColor: "#fff", borderRadius: s(14),
    borderWidth: 1, borderColor: "#eee", overflow: "hidden",
  },
  menuItem: { flexDirection: "row", alignItems: "center", padding: s(16), gap: s(14) },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  menuIcon: { width: s(40), height: s(40), borderRadius: s(10), justifyContent: "center", alignItems: "center" },
  menuContent: { flex: 1 },
  menuLabel: { fontSize: fs(15), fontWeight: "600", color: "#111", marginBottom: vs(2) },
  menuDescription: { fontSize: fs(13), color: "#888", lineHeight: fs(18) },

  /* Bottom-sheet content */
  sheetContent: { flex: 1, padding: s(24) },
  sheetTitle: { fontSize: fs(18), fontWeight: "700", color: "#0a0a0a", marginBottom: vs(16) },
  sheetInputRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f9f9f9", borderWidth: 1, borderColor: "#e5e5e5",
    borderRadius: s(10), marginBottom: vs(12),
  },
  sheetInput: { flex: 1, paddingHorizontal: s(14), paddingVertical: vs(12), fontSize: fs(15), color: "#111" },
  sheetInputFull: {
    backgroundColor: "#f9f9f9", borderWidth: 1, borderColor: "#e5e5e5",
    borderRadius: s(10), paddingHorizontal: s(14), paddingVertical: vs(12),
    fontSize: fs(15), color: "#111", marginBottom: vs(20),
  },
  sheetEye: { paddingHorizontal: s(12), paddingVertical: vs(12) },
  sheetActions: { flexDirection: "row", gap: s(12) },
  sheetBtn: { flex: 1, paddingVertical: vs(12), borderRadius: s(10), alignItems: "center" },
  sheetBtnCancel: { backgroundColor: "#f0f0f0" },
  sheetBtnCancelText: { fontSize: fs(15), fontWeight: "600", color: "#333" },
  sheetBtnConfirm: { backgroundColor: "#0a0a0a" },
  sheetBtnConfirmText: { fontSize: fs(15), fontWeight: "600", color: "#fff" },

  activityHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: vs(16),
  },
  activityList: { marginBottom: vs(16) },
  activityItem: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: vs(12), borderBottomWidth: 1, borderBottomColor: "#f0f0f0", gap: s(12),
  },
  activityIcon: {
    width: s(36), height: s(36), borderRadius: s(18),
    backgroundColor: "#f5f5f5", justifyContent: "center", alignItems: "center",
  },
  activityContent: { flex: 1 },
  activityAction: { fontSize: fs(14), fontWeight: "600", color: "#111", marginBottom: vs(2) },
  activityMeta: { fontSize: fs(12), color: "#999" },
  activityCloseBtn: { backgroundColor: "#f0f0f0", borderRadius: s(10), paddingVertical: vs(12), alignItems: "center" },
  activityCloseBtnText: { fontSize: fs(15), fontWeight: "600", color: "#333" },
});
