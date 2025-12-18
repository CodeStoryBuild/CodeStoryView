# -----------------------------------------------------------------------------
# /*
#  * Copyright (C) 2025 CodeStory
#  *
#  * This program is free software; you can redistribute it and/or modify
#  * it under the terms of the GNU General Public License as published by
#  * the Free Software Foundation; Version 2.
#  *
#  * This program is distributed in the hope that it will be useful,
#  * but WITHOUT ANY WARRANTY; without even the implied warranty of
#  * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
#  * GNU General Public License for more details.
#  *
#  * You should have received a copy of the GNU General Public License
#  * along with this program; if not, you can contact us at support@codestory.build
#  */
# -----------------------------------------------------------------------------
import numpy as np
from loguru import logger


class SklearnLouvainClusterer:
    """
    Clusters embeddings using scikit-learn NearestNeighbors + NetworkX Louvain community detection.
    """

    # 1.1. k (Nearest Neighbor Count) Base Constraints
    # These set the hard floor/ceiling regardless of strictness
    K_MIN_NEIGHBORS = 5
    K_MAX_NEIGHBORS = 50

    # 1.2. k_factor (Controls the sparsity of the graph)
    # Lower k_factor -> sparser graph -> stricter/smaller clusters
    KF_LOOSE = 0.15  # Strictness 0.0 (Dense graph)
    KF_STRICT = 0.05  # Strictness 1.0 (Sparse graph)

    # 1.3. Resolution (Controls the granularity of Louvain clustering)
    # Higher resolution -> more/smaller clusters -> stricter grouping
    RES_LOOSE = 0.5  # Strictness 0.0 (Coarse grouping)
    RES_STRICT = 3.0  # Strictness 1.0 (Fine grouping)

    # -------------------------------------------------------------------------

    def __init__(
        self,
        strictness: float = 0.5,
    ):
        """
        Initializes the clusterer by mapping the strictness parameter to
        the internal k_factor and resolution using LERP.

        :param strictness: Float between 0.0 (Loose/Coarse) and 1.0 (Strict/Fine).
        """

        # 0. Clamp strictness to the defined [0.0, 1.0] range for safety
        self.alpha = np.clip(strictness, 0.0, 1.0)

        # 1. LERP for Resolution (Direct relationship: Higher alpha -> Higher resolution)
        # LERP: P_min + alpha * (P_max - P_min)
        self.resolution = self.RES_LOOSE + self.alpha * (
            self.RES_STRICT - self.RES_LOOSE
        )

        # 2. LERP for K-Factor (Inverse relationship: Higher alpha -> Lower k_factor)
        # Using KF_LOOSE as P_min and KF_STRICT as P_max:
        self.k_factor = self.KF_LOOSE + self.alpha * (self.KF_STRICT - self.KF_LOOSE)

        # 3. Apply base K constraints
        self.min_k = self.K_MIN_NEIGHBORS
        self.max_k = self.K_MAX_NEIGHBORS

        logger.debug(
            f"Clusterer initialized with strictness={self.alpha:.2f}. "
            f"Internal params: k_factor={self.k_factor:.4f}, resolution={self.resolution:.4f}"
        )

    def fit(self, embeddings: list[list[float]]) -> np.ndarray:
        import networkx as nx
        from sklearn.neighbors import NearestNeighbors
        from sklearn.preprocessing import normalize

        # Early exits for edge cases
        if embeddings is None or len(embeddings) == 0:
            return np.array([])

        embeddings = np.asarray(embeddings, dtype="float32")
        n_samples = embeddings.shape[0]

        if n_samples == 1:
            return np.array([0])

        # Normalize embeddings for cosine similarity
        embeddings = normalize(embeddings, norm="l2")

        # Determine k for nearest neighbors
        k = int(self.k_factor * n_samples)
        k = max(self.min_k, min(self.max_k, int(k)))
        k_search = min(k + 1, n_samples)  # include self (+1)

        # Use brute-force kNN with cosine similarity (via inner product on normalized vectors)
        nbrs = NearestNeighbors(
            n_neighbors=k_search, algorithm="brute", metric="cosine"
        )
        nbrs.fit(embeddings)
        distances, neighbors = nbrs.kneighbors(embeddings)

        # Build weighted similarity graph
        # Convert cosine distances to similarities (similarity = 1 - distance)
        G = nx.Graph()
        G.add_nodes_from(range(n_samples))

        for i in range(n_samples):
            for j_idx in range(1, k_search):  # skip self (0)
                neighbor = neighbors[i, j_idx]
                # Convert distance to similarity for graph weighting
                similarity = 1.0 - distances[i, j_idx]
                if neighbor != -1:
                    G.add_edge(i, neighbor, weight=float(similarity))

        # Louvain community detection
        try:
            communities = nx.community.louvain_communities(
                G, resolution=self.resolution
            )
        except Exception as e:
            logger.warning(
                f"Louvain clustering failed: {e}. Fallback to single cluster."
            )
            return np.zeros(n_samples, dtype=int)

        # Assign cluster labels
        labels = np.full(n_samples, -1, dtype=int)
        for label_id, community in enumerate(communities):
            for node in community:
                labels[node] = label_id

        logger.debug(
            f"Clustered {n_samples} embeddings into {len(communities)} clusters."
        )
        return labels


class Clusterer:
    """
    Wrapper class for clustering embeddings.
    """

    def __init__(self, strictness: float = 0.5):
        self.clusterer = SklearnLouvainClusterer(strictness=strictness)

    def cluster(self, embeddings: list[list[float]]):
        return self.clusterer.fit(embeddings)
