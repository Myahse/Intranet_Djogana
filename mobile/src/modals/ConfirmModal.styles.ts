import { StyleSheet } from "react-native";
import { s, vs, fs } from "@/responsive";

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: s(16),
    padding: s(24),
    width: "100%",
    maxWidth: s(320),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: vs(4) },
    shadowOpacity: 0.15,
    shadowRadius: s(12),
    elevation: 8,
  },
  title: {
    fontSize: fs(18),
    fontWeight: "700",
    color: "#0a0a0a",
    marginBottom: vs(8),
  },
  message: {
    fontSize: fs(15),
    color: "#666",
    marginBottom: vs(20),
    lineHeight: fs(22),
  },
  actions: {
    flexDirection: "row",
    gap: s(12),
    marginTop: vs(4),
  },
  btn: {
    flex: 1,
    paddingVertical: vs(12),
    borderRadius: s(10),
    alignItems: "center",
  },
  btnCancel: { backgroundColor: "#f0f0f0" },
  btnCancelText: { fontSize: fs(15), fontWeight: "600", color: "#333" },
  btnConfirm: { backgroundColor: "#0a0a0a" },
  btnDestructive: { backgroundColor: "#dc2626" },
  btnConfirmText: { fontSize: fs(15), fontWeight: "600", color: "#fff" },
});
