#!/usr/bin/env python3
"""HEL-1442 sampler: run one command (under nice -n 19) and sample, ~1 s, the RSS of its whole process tree plus
/proc/meminfo MemAvailable and Shmem. Aborts (kills only the PIDs it recorded) if MemAvailable < FLOOR_KB.
usage: sampler.py <label> <csv-out> -- <command...>   (env FLOOR_GB default 12)
Prints one JSON summary line on stdout."""
import json, os, signal, subprocess, sys, time

FLOOR_KB = int(float(os.environ.get("FLOOR_GB", "12")) * 1024 * 1024)

def meminfo():
    d = {}
    with open("/proc/meminfo") as f:
        for l in f:
            k, v = l.split(":")
            d[k] = int(v.split()[0])
    return d

def snapshot():
    procs = {}
    for e in os.listdir("/proc"):
        if not e.isdigit():
            continue
        try:
            with open(f"/proc/{e}/stat") as f:
                s = f.read()
            rp = s.rindex(")")
            comm = s[s.index("(") + 1:rp]
            ppid = int(s[rp + 2:].split()[1])
            rss = rssanon = 0
            with open(f"/proc/{e}/status") as f:
                for l in f:
                    if l.startswith("VmRSS:"):
                        rss = int(l.split()[1])
                    elif l.startswith("RssAnon:"):
                        rssanon = int(l.split()[1])
            procs[int(e)] = (ppid, comm, rss, rssanon)
        except (OSError, ValueError):
            pass
    return procs

def tree(procs, root):
    kids = {}
    for p, (pp, *_ ) in procs.items():
        kids.setdefault(pp, []).append(p)
    out, st = [], [root]
    while st:
        p = st.pop()
        if p in procs:
            out.append(p)
        st.extend(kids.get(p, []))
    return out

def cmdline(pid, n=160):
    try:
        return open(f"/proc/{pid}/cmdline").read().replace("\0", " ")[:n]
    except OSError:
        return "?"

def main():
    label, csv = sys.argv[1], sys.argv[2]
    cmd = sys.argv[sys.argv.index("--") + 1:]
    m0 = meminfo()
    t0 = time.time()
    p = subprocess.Popen(["nice", "-n", "19"] + cmd, start_new_session=True)
    seen = set()
    jcls = {}  # pid -> class for java procs: "fork" (ForkMain test JVM), "other" (sbt server/launcher, run JVM)
    jpeak = {"fork": 0, "other": 0}; nfork_max = 0; fork_args = ""; fork_xmx_seen = False
    peak = dict(sum_rss=0, sum_anon=0, max_proc_rss=0, max_proc_cmd="", nproc=0, nnode=0, nnode_at_peak=0)
    min_avail, max_shmem, aborted = m0["MemAvailable"], m0["Shmem"], False
    with open(csv, "w") as out:
        out.write("t,avail_kb,shmem_kb,nproc,sum_rss_kb,sum_anon_kb,max_proc_rss_kb,max_proc_comm\n")
        while p.poll() is None:
            procs = snapshot()
            tr = tree(procs, p.pid)
            seen.update(tr)
            sr = sum(procs[x][2] for x in tr)
            sa = sum(procs[x][3] for x in tr)
            nf = 0
            for x in tr:
                if procs[x][1] == "java":
                    if x not in jcls:
                        cl = cmdline(x)
                        jcls[x] = "fork" if "ForkMain" in cmdline(x, 100000) else "other"
                        if jcls[x] == "fork" and not fork_args:
                            fork_args = cl[:120]
                        if jcls[x] == "fork" and "-Xmx" in open(f"/proc/{x}/cmdline").read():
                            fork_xmx_seen = True
                    jpeak[jcls[x]] = max(jpeak[jcls[x]], procs[x][2])
                    nf += jcls[x] == "fork"
            nfork_max = max(nfork_max, nf)
            mx = max(tr, key=lambda x: procs[x][2], default=None)
            mi = meminfo()
            av, sh = mi["MemAvailable"], mi["Shmem"]
            min_avail, max_shmem = min(min_avail, av), max(max_shmem, sh)
            nnode = sum(1 for x in tr if procs[x][1] == "node")
            out.write(f"{time.time()-t0:.1f},{av},{sh},{len(tr)},{sr},{sa},{procs[mx][2] if mx else 0},{procs[mx][1] if mx else ''}\n")
            out.flush()
            peak["nproc"] = max(peak["nproc"], len(tr)); peak["nnode"] = max(peak["nnode"], nnode)
            if sr > peak["sum_rss"]:
                peak["sum_rss"], peak["nnode_at_peak"] = sr, nnode
            peak["sum_anon"] = max(peak["sum_anon"], sa)
            if mx and procs[mx][2] > peak["max_proc_rss"]:
                peak["max_proc_rss"], peak["max_proc_cmd"] = procs[mx][2], cmdline(mx)
            if av < FLOOR_KB:
                aborted = True
                for x in seen:
                    try: os.kill(x, signal.SIGKILL)
                    except OSError: pass
                break
            time.sleep(1.0)
    rc = p.wait()
    print(json.dumps(dict(label=label, rc=rc, aborted=aborted, wall_s=round(time.time() - t0, 1),
        peak_sum_rss_mb=peak["sum_rss"] // 1024, peak_sum_anon_mb=peak["sum_anon"] // 1024,
        max_proc_rss_mb=peak["max_proc_rss"] // 1024, max_proc_cmd=peak["max_proc_cmd"],
        max_nproc=peak["nproc"], fork_jvm_max_rss_mb=jpeak["fork"] // 1024, other_jvm_max_rss_mb=jpeak["other"] // 1024, max_concurrent_fork_jvms=nfork_max, fork_has_xmx=fork_xmx_seen, max_node_procs=peak["nnode"],
        min_avail_gb=round(min_avail / 1048576, 1), start_avail_gb=round(m0["MemAvailable"] / 1048576, 1),
        shmem_start_mb=m0["Shmem"] // 1024, shmem_max_mb=max_shmem // 1024)))
    sys.exit(0 if rc == 0 and not aborted else 1)

main()
