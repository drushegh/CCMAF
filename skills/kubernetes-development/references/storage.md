# Storage

Containers are ephemeral; anything that must survive a restart/reschedule needs
a volume backed by real storage. Don't write persistent data to the container
layer or an `emptyDir`.

## Volumes vs persistent volumes

- **`emptyDir`** — scratch space for a pod's lifetime (caches, tmp, a
  writable path under a read-only root fs). Gone when the pod dies.
- **PersistentVolume (PV)** — a piece of storage in the cluster.
  **PersistentVolumeClaim (PVC)** — a workload's request for one. Pods reference
  the PVC; the PVC binds to a PV.
- **StorageClass** — enables **dynamic provisioning**: a PVC with a
  `storageClassName` triggers the CSI driver to create the PV on demand. The
  norm in cloud clusters.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: managed-csi
  resources:
    requests:
      storage: 20Gi
```

## Access modes (pick correctly)

- **ReadWriteOnce (RWO)** — one node mounts read-write. Azure Disk; databases.
- **ReadWriteMany (RWX)** — many nodes read-write. Azure Files / Blob NFS;
  shared content.
- **ReadOnlyMany (ROX)** — many nodes read-only.
Block storage (Disk) is RWO and faster; file storage (Files) is RWX and shared.
Choose by sharing need and performance, and set the `StorageClass`
`reclaimPolicy` (`Delete` vs `Retain`) deliberately — `Retain` for data you
can't lose.

## Stateful workloads

`StatefulSet.volumeClaimTemplates` provisions a **dedicated PVC per pod** with
stable identity — each replica keeps its own storage across reschedules:

```yaml
spec:
  serviceName: db
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: managed-csi
        resources:
          requests:
            storage: 50Gi
```

Deleting a StatefulSet does **not** delete its PVCs by default (data
protection) — clean up deliberately.

## CSI and AKS

Storage is provided by **CSI drivers**. On AKS: `managed-csi` /
`managed-csi-premium` (Azure Disk, RWO), `azurefile-csi` (Azure Files, RWX),
plus Blob CSI. Match the SKU to the IO profile; premium SSD for databases.

## Operational discipline

- **Back up persistent data** (Velero, Azure Backup for AKS) and *prove*
  restores — a backup is real only when a restore has succeeded.
- Watch capacity; enable volume expansion (`allowVolumeExpansion: true`) rather
  than recreating.
- Prefer managed data services (Azure SQL, PostgreSQL Flexible Server) over
  self-hosting stateful databases in-cluster unless there's a clear reason —
  see `sql-development` / `azure-development`.
