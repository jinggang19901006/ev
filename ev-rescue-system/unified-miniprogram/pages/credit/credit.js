const api = require('../../utils/api.js');
Page({
  data: { score:100, minScore:60, history:[], loading:false },
  onShow() { this._load(); },
  async _load() {
    this.setData({ loading:true });
    try {
      const me = await api.authMe().catch(()=>null);
      const userId = me && me.account && me.account.user_id;
      const info = userId ? await api.user.info().catch(()=>null) : null;
      const list = [];
      if (info && info.credit_score) this.setData({ score: info.credit_score });
      else if (me && me.credit_score) this.setData({ score: me.credit_score });
      this.setData({ history: list });
    } catch (e) {} finally { this.setData({ loading:false }); }
  }
});
