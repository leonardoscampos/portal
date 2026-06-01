---
title: ELK Stack
description: Elasticsearch, Logstash, Kibana e Beats — gerenciamento centralizado de logs, busca, análise e visualização para plataformas cloud-native.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / elk-stack</span>
    <h1 class="dph-title">ELK Stack</h1>
    <p class="dph-desc">O Elastic Stack (Elasticsearch, Logstash, Kibana + Beats) é a plataforma de gerenciamento de logs e busca open-source mais amplamente implantada. Ingira logs estruturados e não estruturados em escala, aplique enriquecimento em tempo real com Logstash ou Elastic Agent e visualize com painéis e alertas do Kibana.</p>
    <div class="dph-badges">
      <span class="tech-badge">Elasticsearch</span>
      <span class="tech-badge">Logstash</span>
      <span class="tech-badge">Kibana</span>
      <span class="tech-badge">Beats / Fleet</span>
      <span class="tech-badge">Elastic Agent</span>
      <span class="tech-badge">ILM</span>
    </div>
  </div>
</div>

[← Visão Geral de Monitoramento](index.md)

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────────┐
│  Data Sources                                                    │
│  K8s pods · syslog · metrics · APM traces · uptime              │
└────────────────────────┬─────────────────────────────────────────┘
                         │
         ┌───────────────┴──────────────────┐
         │  Ingest tier                     │
         │  Filebeat / Metricbeat /         │
         │  Elastic Agent (Fleet-managed)   │
         │  Logstash (transform/enrich)     │
         └───────────────┬──────────────────┘
                         │
         ┌───────────────▼──────────────────┐
         │  Elasticsearch cluster           │
         │  ┌────────┐ ┌────────┐           │
         │  │ Hot    │ │ Warm   │  ILM →    │
         │  │ nodes  │ │ nodes  │  Cold →   │
         │  └────────┘ └────────┘  Delete  │
         └───────────────┬──────────────────┘
                         │
         ┌───────────────▼──────────────────┐
         │  Kibana                          │
         │  Discover · Dashboards · Lens    │
         │  Alerting · Canvas · Maps        │
         └──────────────────────────────────┘
```

---

## ECK — Elastic Cloud no Kubernetes

```bash
# Install ECK Operator
kubectl create -f https://download.elastic.co/downloads/eck/2.14.0/crds.yaml
kubectl apply  -f https://download.elastic.co/downloads/eck/2.14.0/operator.yaml

# Monitor operator logs
kubectl -n elastic-system logs -f statefulset.apps/elastic-operator
```

### Cluster Elasticsearch

```yaml
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: prod
  namespace: elastic-system
spec:
  version: 8.14.0

  nodeSets:
    # Hot nodes — SSD, ingest + search
    - name: hot
      count: 3
      config:
        node.roles: ["master", "data_hot", "data_content", "ingest"]
        xpack.security.enabled: true
        xpack.monitoring.collection.enabled: true
      podTemplate:
        spec:
          initContainers:
            - name: sysctl
              securityContext:
                privileged: true
              command: ["sh", "-c", "sysctl -w vm.max_map_count=262144"]
          containers:
            - name: elasticsearch
              resources:
                requests:
                  memory: 8Gi
                  cpu: "2"
                limits:
                  memory: 8Gi
                  cpu: "4"
              env:
                - name: ES_JAVA_OPTS
                  value: "-Xms4g -Xmx4g"
      volumeClaimTemplates:
        - metadata:
            name: elasticsearch-data
          spec:
            accessModes: [ReadWriteOnce]
            storageClassName: gp3
            resources:
              requests:
                storage: 500Gi

    # Warm nodes — HDD, cheaper storage for older indices
    - name: warm
      count: 2
      config:
        node.roles: ["data_warm"]
      podTemplate:
        spec:
          containers:
            - name: elasticsearch
              resources:
                requests:
                  memory: 4Gi
                limits:
                  memory: 4Gi
      volumeClaimTemplates:
        - metadata:
            name: elasticsearch-data
          spec:
            accessModes: [ReadWriteOnce]
            storageClassName: sc1   # cold HDD
            resources:
              requests:
                storage: 2Ti
```

### Kibana

```yaml
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: prod
  namespace: elastic-system
spec:
  version: 8.14.0
  count: 2
  elasticsearchRef:
    name: prod
  config:
    xpack.fleet.enabled: true
    xpack.fleet.packages:
      - name: kubernetes
        version: latest
      - name: system
        version: latest
    xpack.reporting.enabled: true
  podTemplate:
    spec:
      containers:
        - name: kibana
          resources:
            requests:
              memory: 2Gi
              cpu: "1"
            limits:
              memory: 2Gi
```

---

## Gerenciamento do Ciclo de Vida de Índices (ILM)

```json
PUT _ilm/policy/logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_primary_shard_size": "50gb",
            "max_age": "1d"
          },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 },
          "set_priority": { "priority": 50 }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "freeze": {},
          "set_priority": { "priority": 0 }
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

```json
// Index template that applies the ILM policy
PUT _index_template/logs-template
{
  "index_patterns": ["logs-*"],
  "data_stream": {},
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-policy",
      "index.number_of_shards": 3,
      "index.number_of_replicas": 1,
      "index.codec": "best_compression"
    },
    "mappings": {
      "dynamic_templates": [
        {
          "strings_as_keyword": {
            "match_mapping_type": "string",
            "mapping": { "type": "keyword" }
          }
        }
      ],
      "properties": {
        "@timestamp":  { "type": "date" },
        "message":     { "type": "text" },
        "level":       { "type": "keyword" },
        "service":     { "type": "keyword" },
        "trace_id":    { "type": "keyword" },
        "span_id":     { "type": "keyword" }
      }
    }
  }
}
```

---

## Elastic Agent + Fleet (Kubernetes)

Fleet é a interface de gerenciamento centralizado para implantações do Elastic Agent — sem arquivos de configuração manual do Beats.

```yaml
apiVersion: agent.k8s.elastic.co/v1alpha1
kind: Agent
metadata:
  name: fleet-server
  namespace: elastic-system
spec:
  version: 8.14.0
  kibanaRef:
    name: prod
  elasticsearchRefs:
    - name: prod
  mode: fleet
  fleetServerEnabled: true
  policyID: fleet-server-policy
  deployment:
    replicas: 1
---
apiVersion: agent.k8s.elastic.co/v1alpha1
kind: Agent
metadata:
  name: elastic-agent
  namespace: elastic-system
spec:
  version: 8.14.0
  kibanaRef:
    name: prod
  fleetServerRef:
    name: fleet-server
  mode: fleet
  policyID: kubernetes-policy     # assign integrations in Fleet UI / API
  daemonSet:
    podTemplate:
      spec:
        serviceAccountName: elastic-agent
        hostNetwork: true
        dnsPolicy: ClusterFirstWithHostNet
        automountServiceAccountToken: true
        tolerations:
          - operator: Exists
        containers:
          - name: agent
            resources:
              requests:
                memory: 400Mi
                cpu: 200m
              limits:
                memory: 700Mi
```

---

## Pipeline do Logstash

```ruby
# /etc/logstash/conf.d/k8s-logs.conf
input {
  kafka {
    bootstrap_servers => "kafka.kafka.svc:9092"
    topics            => ["k8s-logs"]
    group_id          => "logstash-k8s"
    codec             => json
    consumer_threads  => 4
  }
}

filter {
  # Parse JSON log body if app emits structured logs
  if [log] =~ /^\{/ {
    json {
      source => "log"
      target => "parsed"
    }
    mutate {
      rename => { "[parsed][message]" => "message" }
      rename => { "[parsed][level]"   => "log.level" }
      rename => { "[parsed][trace_id]" => "trace.id" }
    }
  }

  # Kubernetes metadata enrichment
  mutate {
    add_field => {
      "service.name"    => "%{[kubernetes][labels][app]}"
      "service.version" => "%{[kubernetes][labels][version]}"
    }
  }

  # Drop health check noise
  if [kubernetes][labels][app] == "nginx-ingress" and
     [request] =~ "/health" {
    drop {}
  }

  # GeoIP for source IPs
  if [client_ip] {
    geoip {
      source => "client_ip"
      target => "geoip"
    }
  }
}

output {
  elasticsearch {
    hosts     => ["https://prod-es-http.elastic-system.svc:9200"]
    ssl       => true
    ssl_certificate_verification => true
    cacert    => "/usr/share/logstash/config/certs/ca.crt"
    user      => "logstash_writer"
    password  => "${LOGSTASH_PASSWORD}"
    data_stream => true
    data_stream_type      => "logs"
    data_stream_dataset   => "kubernetes"
    data_stream_namespace => "production"
  }
}
```

---

## DSL de Consulta do Elasticsearch

```bash
# Full-text search across logs
curl -X GET "https://es.example.com:9200/logs-*/_search" \
  -H "Content-Type: application/json" \
  -u elastic:$ES_PASSWORD \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "match": { "message": "connection refused" } },
          { "term": { "service": "my-api" } }
        ],
        "filter": [
          { "range": { "@timestamp": { "gte": "now-1h" } } }
        ]
      }
    },
    "sort": [{ "@timestamp": { "order": "desc" } }],
    "size": 50
  }'

# Aggregation — error count by service (last 24h)
curl -X GET "https://es.example.com:9200/logs-*/_search" \
  -u elastic:$ES_PASSWORD \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "filter": [
          { "term": { "log.level": "ERROR" } },
          { "range": { "@timestamp": { "gte": "now-24h" } } }
        ]
      }
    },
    "aggs": {
      "by_service": {
        "terms": { "field": "service.name", "size": 20 },
        "aggs": {
          "over_time": {
            "date_histogram": {
              "field": "@timestamp",
              "calendar_interval": "1h"
            }
          }
        }
      }
    }
  }'
```

---

## Alertas no Kibana (REST)

```bash
# Create threshold rule — too many errors in 5 minutes
curl -X POST "https://kibana.example.com/api/alerting/rule" \
  -u elastic:$ES_PASSWORD \
  -H "Content-Type: application/json" \
  -H "kbn-xsrf: true" \
  -d '{
    "name": "High error rate — my-api",
    "rule_type_id": ".es-query",
    "consumer": "logs",
    "schedule": { "interval": "1m" },
    "params": {
      "index": ["logs-*"],
      "timeField": "@timestamp",
      "esQuery": "{\"query\":{\"bool\":{\"filter\":[{\"term\":{\"service.name\":\"my-api\"}},{\"term\":{\"log.level\":\"ERROR\"}}]}}}",
      "timeWindowSize": 5,
      "timeWindowUnit": "m",
      "thresholdComparator": ">",
      "threshold": [100]
    },
    "actions": [{
      "id": "<slack-connector-id>",
      "group": "threshold met",
      "params": {
        "message": "my-api logged {{context.value}} errors in the last 5 minutes."
      }
    }]
  }'
```

---

## Comandos CLI Úteis

```bash
# Cluster health
curl -u elastic:$ES_PASSWORD https://es.example.com:9200/_cluster/health?pretty

# Index stats
curl -u elastic:$ES_PASSWORD https://es.example.com:9200/_cat/indices/logs-*?v&s=store.size:desc

# Shard allocation
curl -u elastic:$ES_PASSWORD https://es.example.com:9200/_cat/shards?v&h=index,shard,prirep,state,node

# ILM explain (debug why index didn't roll over)
curl -u elastic:$ES_PASSWORD https://es.example.com:9200/logs-*/_ilm/explain?human

# Snapshot (backup)
curl -X PUT -u elastic:$ES_PASSWORD \
  "https://es.example.com:9200/_snapshot/s3-repo/snapshot-$(date +%Y%m%d)" \
  -H "Content-Type: application/json" \
  -d '{"indices": "logs-*", "include_global_state": false}'

# Check ECK resources
kubectl get elasticsearch,kibana,agent -n elastic-system
kubectl get pods -n elastic-system -l common.k8s.elastic.co/type=elasticsearch
```

[← Visão Geral de Monitoramento](index.md)
