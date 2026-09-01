export type OpenRagAdapterStatus = {
  requested: "openrag";
  active: false;
  status: "disabled_for_challenge_candidate" | "interface_enabled_runtime_unavailable";
  retrievalAuthority: "seedy_bounded_retrieval";
  evidenceAuthority: "seedy_rights_and_exact_page_contract";
};

/**
 * OpenRAG is an optional candidate-retrieval adapter, never the authority for
 * identity, rights, page provenance, or evidence promotion. The Challenge
 * candidate deliberately ships without an OpenSearch/Langflow/Docling runtime.
 */
export function getOpenRagAdapterStatus(): OpenRagAdapterStatus {
  return {
    requested: "openrag",
    active: false,
    status: process.env.OPENRAG_ADAPTER_ENABLED === "true"
      ? "interface_enabled_runtime_unavailable"
      : "disabled_for_challenge_candidate",
    retrievalAuthority: "seedy_bounded_retrieval",
    evidenceAuthority: "seedy_rights_and_exact_page_contract",
  };
}
