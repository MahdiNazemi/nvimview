(function () {
  function hostMatches(pattern, host) {
    const cleanPattern = pattern.trim().toLowerCase();
    const cleanHost = host.toLowerCase();

    if (!cleanPattern) {
      return false;
    }
    if (cleanPattern.startsWith("*.")) {
      const suffix = cleanPattern.slice(2);
      return cleanHost === suffix || cleanHost.endsWith(`.${suffix}`);
    }
    return cleanHost === cleanPattern;
  }

  function ruleMatches(rule, url) {
    const parsed = new URL(url);

    if (rule.kind === "host") {
      return hostMatches(rule.pattern, parsed.hostname);
    }
    if (rule.kind === "urlContains") {
      return url.includes(rule.pattern);
    }
    return false;
  }

  function isUrlDenied(url, settings) {
    return (settings.urlRules?.deny || []).some((rule) => ruleMatches(rule, url));
  }

  function isUrlAllowed(url, settings) {
    const allow = settings.urlRules?.allow || [];
    if (allow.length === 0) {
      return true;
    }
    return allow.some((rule) => ruleMatches(rule, url));
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    hostMatches,
    isUrlAllowed,
    isUrlDenied,
    ruleMatches,
  };
})();
