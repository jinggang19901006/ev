const api = require('../../utils/api.js');
Page({
  data: { id:0, card: null, usageList:[], check:null, loading:false },
  onLoad(opts) { this.setData({ id: Number(opts.id) }); this._load(); },
  async _load() {
    this.setData({ loading:true });
    try {
      const [mine, usagesRes] = await Promise.all([
        api.cards.mine().then(r => (r.list || []).find(c => c.id === this.data.id)),
        api.cards.usagesMine()
      ]);
      // usagesMine 经 request 封装后 resolve 的是 body.data = { total, list }
      const usages = (usagesRes && usagesRes.list) || [];
      const list = usages.filter(u => Number(u.card_id) === Number(this.data.id));
      this.setData({ card: mine, usageList: list });
    } catch (e) {} finally { this.setData({ loading:false }); }
  }
});
