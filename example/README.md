## Docs
- https://cloud.google.com/kubernetes-engine/docs/how-to/enabling-multi-cluster-gateways
- https://cloud.google.com/kubernetes-engine/docs/how-to/deploying-multi-cluster-gateways

```bash
export PROJECT_NO=xxxxxxxxxxx
export PROJECT_ID="sandbox-mc-gateway"
export CLUSTER_1=gke-west-1
export CLUSTER_2=gke-east-1
export ZONE_1=us-west1-a
export ZONE_2=us-east1-b
export CLUSTER_REGION_1=us-west1
export CLUSTER_REGION_2=us-east1
export VERSION="1.27.3-gke.100"
echo $PROJECT_NO
echo $PROJECT_ID
echo $ZONE_1
echo $ZONE_2
echo $CLUSTER_REGION_1
echo $CLUSTER_REGION_2
echo $CLUSTER_1
echo $CLUSTER_2
echo $VERSION
```

```bash
gcloud config set project $PROJECT_ID


gcloud services enable \
  trafficdirector.googleapis.com \
  multiclusterservicediscovery.googleapis.com \
  multiclusteringress.googleapis.com \
  --project=$PROJECT_ID


gcloud container clusters create $CLUSTER_1 \
    --gateway-api=standard \
    --zone=$ZONE_1 \
    --workload-pool=${PROJECT_ID}.svc.id.goog \
    --cluster-version=$VERSION \
    --project=$PROJECT_ID \
    -q
gcloud container clusters create $CLUSTER_2 \
    --gateway-api=standard \
    --zone=$ZONE_2 \
    --workload-pool=${PROJECT_ID}.svc.id.goog \
    --cluster-version=$VERSION \
    --project=$PROJECT_ID \
    -q


gcloud container clusters get-credentials $CLUSTER_1 --zone=$ZONE_1 --project=$PROJECT_ID
gcloud container clusters get-credentials $CLUSTER_2 --zone=$ZONE_2 --project=$PROJECT_ID


kubectl config rename-context gke_${PROJECT_ID}_${ZONE_1}_${CLUSTER_1} $CLUSTER_1
kubectl config rename-context gke_${PROJECT_ID}_${ZONE_2}_${CLUSTER_2} $CLUSTER_2


gcloud container fleet memberships register $CLUSTER_1 \
     --gke-cluster ${ZONE_1}/${CLUSTER_1} \
     --enable-workload-identity \
     --project=$PROJECT_ID
gcloud container fleet memberships register $CLUSTER_2 \
     --gke-cluster ${ZONE_2}/${CLUSTER_2} \
     --enable-workload-identity \
     --project=$PROJECT_ID


gcloud container fleet memberships list --project=$PROJECT_ID


gcloud container fleet multi-cluster-services enable \
    --project $PROJECT_ID


gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member "serviceAccount:${PROJECT_ID}.svc.id.goog[gke-mcs/gke-mcs-importer]" \
    --role "roles/compute.networkViewer" \
    --project=$PROJECT_ID


gcloud container fleet multi-cluster-services describe --project=$PROJECT_ID


gcloud container fleet ingress enable \
    --config-membership=projects/${PROJECT_NO}/locations/${CLUSTER_REGION_1}/memberships/${CLUSTER_1} \
    --project=$PROJECT_ID
gcloud container fleet ingress enable \
    --config-membership="projects/${PROJECT_NO}/locations/${CLUSTER_REGION_2}/memberships/${CLUSTER_2}" \
    --project=$PROJECT_ID


gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member "serviceAccount:service-${PROJECT_NO}@gcp-sa-multiclusteringress.iam.gserviceaccount.com" \
    --role "roles/container.admin" \
    --project=$PROJECT_ID


gcloud container fleet ingress describe --project=$PROJECT_ID


kubectl get gatewayclasses --context=$CLUSTER_1


gcloud container clusters update $CLUSTER_1 \
    --gateway-api=standard \
    --zone=$ZONE_1
gcloud container clusters update $CLUSTER_2 \
    --gateway-api=standard \
    --zone=$ZONE_2


kubectl apply --context $CLUSTER_1 -f https://raw.githubusercontent.com/GoogleCloudPlatform/gke-networking-recipes/main/gateway/gke-gateway-controller/multi-cluster-gateway/store.yaml
kubectl apply --context $CLUSTER_2 -f https://raw.githubusercontent.com/GoogleCloudPlatform/gke-networking-recipes/main/gateway/gke-gateway-controller/multi-cluster-gateway/store.yaml


cat << EOF | kubectl apply --context $CLUSTER_1 -f -
apiVersion: v1
kind: Service
metadata:
  name: store
  namespace: store
spec:
  selector:
    app: store
  ports:
  - port: 8080
    targetPort: 8080
---
kind: ServiceExport
apiVersion: net.gke.io/v1
metadata:
  name: store
  namespace: store
---
apiVersion: v1
kind: Service
metadata:
  name: store-west-1
  namespace: store
spec:
  selector:
    app: store
  ports:
  - port: 8080
    targetPort: 8080
---
kind: ServiceExport
apiVersion: net.gke.io/v1
metadata:
  name: store-west-1
  namespace: store
EOF

cat << EOF | kubectl apply --context $CLUSTER_2 -f -
apiVersion: v1
kind: Service
metadata:
  name: store
  namespace: store
spec:
  selector:
    app: store
  ports:
  - port: 8080
    targetPort: 8080
---
kind: ServiceExport
apiVersion: net.gke.io/v1
metadata:
  name: store
  namespace: store
---
apiVersion: v1
kind: Service
metadata:
  name: store-east-1
  namespace: store
spec:
  selector:
    app: store
  ports:
  - port: 8080
    targetPort: 8080
---
kind: ServiceExport
apiVersion: net.gke.io/v1
metadata:
  name: store-east-1
  namespace: store
EOF


kubectl get serviceexports --context $CLUSTER_1 --namespace store
kubectl get serviceexports --context $CLUSTER_2 --namespace store


kubectl get serviceimports --context $CLUSTER_1 --namespace store
kubectl get serviceimports --context $CLUSTER_2 --namespace store


cat << EOF | kubectl apply --context $CLUSTER_1 -f -
kind: Gateway
apiVersion: gateway.networking.k8s.io/v1beta1
metadata:
  name: external-http
  namespace: store
spec:
  gatewayClassName: gke-l7-global-external-managed-mc
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      kinds:
      - kind: HTTPRoute
EOF

cat << EOF | kubectl apply --context $CLUSTER_1 -f -
kind: HTTPRoute
apiVersion: gateway.networking.k8s.io/v1beta1
metadata:
  name: public-store-route
  namespace: store
  labels:
    gateway: external-http
spec:
  hostnames:
  - "store.example.com"
  parentRefs:
  - name: external-http
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /west
    backendRefs:
    - group: net.gke.io
      kind: ServiceImport
      name: store-west-1
      port: 8080
  - matches:
    - path:
        type: PathPrefix
        value: /east
    backendRefs:
      - group: net.gke.io
        kind: ServiceImport
        name: store-east-1
        port: 8080
  - backendRefs:
    - group: net.gke.io
      kind: ServiceImport
      name: store
      port: 8080
EOF


kubectl describe gateways.gateway.networking.k8s.io external-http --context $CLUSTER_1 --namespace store


kubectl get gateways.gateway.networking.k8s.io external-http -o=jsonpath="{.status.addresses[0].value}" --context $CLUSTER_1 --namespace store


curl -H "host: store.example.com" http://x.x.x.x


curl -H "host: store.example.com" http://x.x.x.x/west
curl -H "host: store.example.com" http://x.x.x.x/east
```

```bash
yamamoto_daisuke@cloudshell:~ (hoge)$ curl -H "host: store.example.com" http://x.x.x.x
{
"cluster_name":"gke-west-1",
"gce_instance_id":"-",
"gce_service_account":"sandbox-mc-gateway.svc.id.goog",
"host_header":"store.example.com",
"pod_name":"store-5b74fdb87c-p8dmt",
"pod_name_emoji":"\ud83e\udd30\ud83c\udfff","
project_id":"sandbox-mc-gateway",
"timestamp":"2023-11-28T04:58:32","zone":"us-west1-a"
}
yamamoto_daisuke@cloudshell:~ (hoge)$
yamamoto_daisuke@cloudshell:~ (hoge)$ curl -i store.example.com
HTTP/1.1 200 OK
server: Werkzeug/2.3.7 Python/3.11.3
date: Tue, 28 Nov 2023 04:59:35 GMT
content-type: application/json
Content-Length: 326
access-control-allow-origin: *
via: 1.1 google

{"cluster_name":"gke-west-1",
"gce_instance_id":"-",
"gce_service_account":"sandbox-mc-gateway.svc.id.goog",
"host_header":"store.example.com",
"pod_name":"store-5b74fdb87c-p8dmt",
"pod_name_emoji":"\ud83e\udd30\ud83c\udfff",
"project_id":"sandbox-mc-gateway",
"timestamp":"2023-11-28T04:59:35","zone":"us-west1-a"}
yamamoto_daisuke@cloudshell:~ (hoge)$
yamamoto_daisuke@cloudshell:~ (hoge)$ curl -H "host: store.example.com" http://x.x.x.x/west
{"cluster_name":"gke-west-1",
"gce_instance_id":"-",
"gce_service_account":"sandbox-mc-gateway.svc.id.goog",
"host_header":"store.example.com",
"pod_name":"store-5b74fdb87c-p8dmt",
"pod_name_emoji":"\ud83e\udd30\ud83c\udfff",
"project_id":"sandbox-mc-gateway",
"timestamp":"2023-11-28T05:01:21",
"zone":"us-west1-a"}
yamamoto_daisuke@cloudshell:~ (hoge)$ curl -H "host: store.example.com" http://x.x.x.x/east
{"cluster_name":"gke-east-1",
"gce_instance_id":"6205714523048438393",
"gce_service_account":"sandbox-mc-gateway.svc.id.goog",
"host_header":"store.example.com",
"pod_name":"store-5b74fdb87c-lbggt",
"pod_name_emoji":"\ud83c\uddf5\ud83c\uddec",
"project_id":"sandbox-mc-gateway",
"timestamp":"2023-11-28T05:01:27",
"zone":"us-east1-b"}
yamamoto_daisuke@cloudshell:~ (hoge)$
```
